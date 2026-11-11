import hashlib
import io
import re
import uuid
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
from uuid import UUID

import numpy as np
import pandas as pd
from fastapi import HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.core.storage import storage
from app.repositories.models import DatasetModel


class DatasetValidationError(ValueError):
    pass


def _safe_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("._")
    return cleaned[:120] or "dataset.csv"


def _read_csv_bytes(content: bytes, nrows: Optional[int] = None) -> pd.DataFrame:
    last_error: Optional[Exception] = None
    for encoding in ("utf-8", "utf-8-sig", "latin-1"):
        try:
            return pd.read_csv(
                io.BytesIO(content),
                nrows=nrows,
                sep=None,
                engine="python",
                encoding=encoding,
            )
        except UnicodeDecodeError as exc:
            last_error = exc
            continue
        except Exception as exc:
            last_error = exc
            continue
    raise DatasetValidationError(f"No fue posible interpretar el CSV: {last_error}")


def infer_task(series: pd.Series, total_rows: int) -> str:
    if series.dtype == object or str(series.dtype) == "bool" or str(series.dtype).startswith("category"):
        return "classification"
    unique = series.nunique(dropna=True)
    if unique <= max(2, min(20, int(total_rows * 0.05))):
        return "classification"
    return "regression"


# Debe coincidir con workers/training/preprocessing.py. El diseñador usa este
# cálculo para mostrar las neuronas de entrada reales del modelo.
ONE_HOT_MAX_CATEGORIES = 30
MAX_FEATURES_FOR_BREAKDOWN = 200


def _is_numeric_like(series: pd.Series) -> bool:
    """Misma regla que el worker: numérica, o ≥95% convertible a número."""
    if pd.api.types.is_numeric_dtype(series):
        return True
    if pd.api.types.is_bool_dtype(series):
        return False
    converted = pd.to_numeric(series, errors="coerce")
    non_null = series.notna().sum()
    return bool(non_null > 0 and (converted.notna().sum() / non_null) >= 0.95)


def summarize_features(
    frame: pd.DataFrame, target_column: Optional[str], task: Optional[str]
) -> Dict[str, Any]:
    """Calcula las neuronas de entrada/salida que tendrá el modelo.

    Replica las reglas del worker: cada columna numérica aporta una neurona,
    cada categórica con ≤30 valores se expande a one-hot (una neurona por
    valor) y el resto se codifica de forma ordinal (una neurona).
    """
    if not target_column or target_column not in frame.columns:
        return {"available": False, "reason": "El dataset no tiene columna objetivo"}

    features = frame.drop(columns=[target_column])
    breakdown: list[dict[str, Any]] = []
    input_neurons = 0
    for column in features.columns:
        series = features[column]
        if series.notna().sum() == 0:
            continue  # El worker descarta columnas completamente vacías.
        entry: dict[str, Any] = {"name": str(column)}
        if _is_numeric_like(series):
            entry.update({"kind": "numeric", "neurons": 1})
            input_neurons += 1
        else:
            filled = series.where(series.notna(), "missing").astype(str)
            values = sorted(filled.unique().tolist())
            if len(values) <= ONE_HOT_MAX_CATEGORIES:
                entry.update(
                    {
                        "kind": "one_hot",
                        "neurons": len(values),
                        "values": values[: ONE_HOT_MAX_CATEGORIES + 1],
                    }
                )
                input_neurons += len(values)
            else:
                entry.update({"kind": "ordinal", "neurons": 1})
                input_neurons += 1
        breakdown.append(entry)

    if task == "classification":
        labels = sorted(frame[target_column].dropna().astype(str).unique().tolist())
        n_classes = max(2, len(labels))
        output_neurons = 1 if n_classes == 2 else n_classes
        activation = "sigmoid" if n_classes == 2 else "softmax"
        loss = "binary_crossentropy" if n_classes == 2 else "sparse_categorical_crossentropy"
    else:
        labels = []
        n_classes = 0
        output_neurons = 1
        activation = "linear"
        loss = "mse"

    return {
        "available": True,
        "input_neurons": input_neurons,
        "output_neurons": output_neurons,
        "output_activation": activation,
        "loss": loss,
        "class_labels": labels[:50],
        "class_count": n_classes,
        "features": breakdown[:MAX_FEATURES_FOR_BREAKDOWN],
        "truncated": len(breakdown) > MAX_FEATURES_FOR_BREAKDOWN,
    }


def inspect_csv(content: bytes, target_column: Optional[str]) -> Dict[str, Any]:
    if not content:
        raise DatasetValidationError("El archivo CSV está vacío")

    header_frame = _read_csv_bytes(content, nrows=1)
    if header_frame.shape[1] < 2:
        raise DatasetValidationError(
            "El CSV debe contener encabezados explícitos y al menos dos columnas"
        )
    if any(str(col).startswith("Unnamed:") or not str(col).strip() for col in header_frame.columns):
        raise DatasetValidationError("El CSV contiene columnas sin encabezado explícito")
    if len(set(header_frame.columns)) != len(header_frame.columns):
        raise DatasetValidationError("El CSV contiene encabezados duplicados")
    if header_frame.shape[1] > settings.MAX_CSV_COLUMNS:
        raise DatasetValidationError(
            f"El CSV excede el máximo de {settings.MAX_CSV_COLUMNS} columnas"
        )

    frame = _read_csv_bytes(content, nrows=settings.MAX_CSV_ROWS + 1)
    total_rows = len(frame)
    if total_rows == 0:
        raise DatasetValidationError("El CSV no contiene filas de datos")
    if total_rows < 10:
        raise DatasetValidationError("El CSV debe contener al menos 10 filas de datos")
    if total_rows > settings.MAX_CSV_ROWS:
        raise DatasetValidationError(
            f"El CSV excede el máximo de {settings.MAX_CSV_ROWS} filas"
        )

    target = target_column.strip() if target_column else None
    if target and target not in frame.columns:
        raise DatasetValidationError(f"La columna objetivo '{target}' no existe en el CSV")

    if target:
        non_null_target = frame[target].dropna()
        if non_null_target.empty:
            raise DatasetValidationError("La columna objetivo no contiene valores válidos")
        if non_null_target.nunique() < 2:
            raise DatasetValidationError(
                "La columna objetivo debe contener al menos dos clases/valores distintos"
            )
        task = infer_task(frame[target], total_rows)
    else:
        task = None

    columns = [
        {
            "name": str(col),
            "dtype": str(frame[col].dtype),
            "null_count": int(frame[col].isna().sum()),
            "unique": int(frame[col].nunique(dropna=True)),
        }
        for col in frame.columns
    ]
    null_counts = {str(col): int(frame[col].isna().sum()) for col in frame.columns}

    return {
        "samples": total_rows,
        "features_count": max(0, frame.shape[1] - (1 if target else 0)),
        "target_column": target,
        "task": task,
        # Neuronas de entrada/salida que tendrá el modelo con este CSV.
        "neurons": summarize_features(frame, target, task),
        "columns": columns,
        "null_counts": null_counts,
        "dtypes": {str(col): str(frame[col].dtype) for col in frame.columns},
        "train_split": 0.70,
        "val_split": 0.15,
        "test_split": 0.15,
        "verified": True,
    }


def build_preview(
    content: bytes,
    metadata: Dict[str, Any],
    limit: int = 10,
) -> Tuple[list, dict, dict, int, dict]:
    frame = _read_csv_bytes(content, nrows=limit)
    columns = [str(c) for c in frame.columns]
    dtypes = metadata.get("dtypes") or {str(c): str(frame[c].dtype) for c in frame.columns}
    null_counts = metadata.get("null_counts") or {
        str(c): int(frame[c].isna().sum()) for c in frame.columns
    }
    rows = each_row_safe(frame.to_dict(orient="records"))
    return columns, dtypes, rows, int(metadata.get("samples", len(frame))), null_counts


def each_row_safe(rows: list) -> list:
    safe = []
    for row in rows:
        safe.append(
            {
                key: (
                    None
                    if value is None or (isinstance(value, float) and np.isnan(value))
                    else value.item()
                    if isinstance(value, np.generic)
                    else value
                )
                for key, value in row.items()
            }
        )
    return safe


async def create_dataset_from_upload(
    db: AsyncSession,
    *,
    project_id: UUID,
    file: UploadFile,
    name: Optional[str],
    target_column: Optional[str],
    created_by: UUID,
) -> DatasetModel:
    filename = file.filename or "dataset.csv"
    if not filename.lower().endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El archivo debe tener extensión .csv",
        )

    max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
    content = bytearray()
    while chunk := await file.read(1024 * 1024):
        content.extend(chunk)
        if len(content) > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"El archivo excede el límite de {settings.MAX_UPLOAD_MB} MB",
            )
    raw = bytes(content)

    try:
        metadata = await run_in_threadpool(inspect_csv, raw, target_column)
    except DatasetValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"CSV inválido: {exc}",
        )

    checksum = hashlib.sha256(raw).hexdigest()
    dataset_id = uuid.uuid4()
    relative_key = f"datasets/{project_id}/{dataset_id}.csv"
    await run_in_threadpool(storage.put_bytes, relative_key, raw, "text/csv")

    dataset_name = (name or Path(filename).stem)[:200]
    version_number = 1
    existing = (
        await db.scalars(
            select(DatasetModel).where(
                DatasetModel.project_id == project_id, DatasetModel.name == dataset_name
            )
        )
    ).all()
    if existing:
        version_number = len(existing) + 1

    dataset = DatasetModel(
        id=dataset_id,
        project_id=project_id,
        name=dataset_name,
        version=f"v1.{version_number - 1}",
        storage_key=relative_key,
        original_filename=_safe_name(filename),
        size_bytes=len(raw),
        checksum=checksum,
        target_column=metadata.get("target_column"),
        verified=True,
        metadata_json=metadata,
        created_by=created_by,
    )
    db.add(dataset)
    return dataset
