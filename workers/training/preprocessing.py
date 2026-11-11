"""Preparación real de datasets CSV para entrenamiento.

Incluye lectura robusta de codificaciones, validación de esquema, imputación,
codificación de categóricas, división train/validación/test y escalado. El
objeto ``preprocessor`` ajustado se guarda junto al modelo para que la misma
transformación pueda reutilizarse en inferencia.
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import (
    LabelEncoder,
    OneHotEncoder,
    OrdinalEncoder,
    StandardScaler,
)

from worker_config import (
    MAX_CSV_COLUMNS,
    MAX_CSV_ROWS,
    MAX_FEATURES_AFTER_ENCODING,
)

ONE_HOT_MAX_CATEGORIES = 30


class DataPreparationError(ValueError):
    """Error de datos con un mensaje apto para mostrarse al usuario."""


@dataclass
class PreparedDataset:
    X_train: np.ndarray
    X_val: np.ndarray
    X_test: np.ndarray
    y_train: np.ndarray
    y_val: np.ndarray
    y_test: np.ndarray
    input_dim: int
    task: str
    target_column: str
    output_units: int
    output_activation: str
    loss: str
    metrics: List[str]
    class_labels: List[str] = field(default_factory=list)
    feature_names: List[str] = field(default_factory=list)
    numeric_columns: List[str] = field(default_factory=list)
    categorical_columns: List[str] = field(default_factory=list)
    preprocessor: Optional[ColumnTransformer] = None
    numeric_scaler: Optional[StandardScaler] = None
    label_encoder: Optional[LabelEncoder] = None
    samples: int = 0
    samples_train: int = 0
    samples_val: int = 0
    samples_test: int = 0
    # --- Trazabilidad y control de sesgo (Nivel A) ---
    class_weights: Dict[int, float] = field(default_factory=dict)
    train_class_distribution: Dict[str, int] = field(default_factory=dict)
    input_schema: List[Dict[str, Any]] = field(default_factory=list)
    duplicate_rows: int = 0
    val_split: float = 0.15
    test_split: float = 0.15
    stratified: bool = False

    def scaler_bundle(self) -> Dict[str, Any]:
        return {
            "version": 2,
            "task": self.task,
            "target_column": self.target_column,
            "feature_names": self.feature_names,
            "numeric_columns": self.numeric_columns,
            "categorical_columns": self.categorical_columns,
            "categorical_values": {
                item["name"]: item.get("values", [])
                for item in self.input_schema
                if item.get("kind") == "categorical"
            },
            "input_schema": self.input_schema,
            "class_labels": self.class_labels,
            "output_units": self.output_units,
            "output_activation": self.output_activation,
            "loss": self.loss,
            "preprocessor": self.preprocessor,
            "numeric_scaler": self.numeric_scaler,
            "label_encoder": self.label_encoder,
        }


def _read_csv(path: Path) -> pd.DataFrame:
    last_error: Optional[Exception] = None
    for encoding in ("utf-8", "utf-8-sig", "latin-1"):
        try:
            return pd.read_csv(
                path,
                sep=None,
                engine="python",
                encoding=encoding,
                nrows=MAX_CSV_ROWS + 1,
            )
        except UnicodeDecodeError as exc:
            last_error = exc
        except Exception as exc:  # separador/archivo corrupto
            last_error = exc
    raise DataPreparationError(f"No fue posible interpretar el CSV: {last_error}")


def _infer_task(series: pd.Series, total_rows: int) -> str:
    if not pd.api.types.is_numeric_dtype(series):
        return "classification"
    unique = int(series.nunique(dropna=True))
    threshold = max(2, min(20, int(total_rows * 0.05)))
    return "classification" if unique <= threshold else "regression"


def _is_numeric_like(series: pd.Series) -> bool:
    if pd.api.types.is_numeric_dtype(series):
        return True
    if pd.api.types.is_bool_dtype(series):
        return False
    converted = pd.to_numeric(series, errors="coerce")
    non_null = series.notna().sum()
    return non_null > 0 and (converted.notna().sum() / non_null) >= 0.95


def _split(
    X: pd.DataFrame,
    y: np.ndarray,
    *,
    task: str,
    val_split: float,
    test_split: float,
    random_state: int,
) -> Tuple[
    pd.DataFrame,
    pd.DataFrame,
    pd.DataFrame,
    np.ndarray,
    np.ndarray,
    np.ndarray,
    bool,
]:
    holdout = max(0.05, min(0.8, val_split + test_split))
    stratify = None
    stratified = False
    if task == "classification":
        counts = np.bincount(y.astype(int))
        if len(counts) > 1 and counts[counts > 0].min() >= 2:
            stratify = y
    try:
        X_train, X_hold, y_train, y_hold = train_test_split(
            X,
            y,
            test_size=holdout,
            random_state=random_state,
            stratify=stratify,
        )
        stratified = stratify is not None
    except ValueError:
        X_train, X_hold, y_train, y_hold = train_test_split(
            X, y, test_size=holdout, random_state=random_state
        )
        stratified = False

    relative_test = test_split / holdout if holdout > 0 else 0.5
    relative_test = max(0.05, min(0.95, relative_test))
    stratify_hold = y_hold if task == "classification" and len(np.unique(y_hold)) > 1 else None
    try:
        X_val, X_test, y_val, y_test = train_test_split(
            X_hold,
            y_hold,
            test_size=relative_test,
            random_state=random_state,
            stratify=stratify_hold,
        )
    except ValueError:
        X_val, X_test, y_val, y_test = train_test_split(
            X_hold, y_hold, test_size=relative_test, random_state=random_state
        )
        stratified = False
    return X_train, X_val, X_test, y_train, y_val, y_test, stratified


def _build_input_schema(
    frame: pd.DataFrame,
    numeric_columns: List[str],
    categorical_columns: List[str],
) -> List[Dict[str, Any]]:
    """Describe las columnas originales para poder construir formularios de inferencia.

    Se incluyen estadísticos de los numéricos y, para las categóricas con pocas
    categorías, la lista de valores observados (de modo que la interfaz pueda
    ofrecer un selector en lugar de un campo libre).
    """
    schema: List[Dict[str, Any]] = []
    for column in numeric_columns:
        series = pd.to_numeric(frame[column], errors="coerce")
        minimum = series.min()
        maximum = series.max()
        median = series.median()
        schema.append(
            {
                "name": str(column),
                "kind": "numeric",
                "nullable": bool(frame[column].isna().any()),
                "min": float(minimum) if pd.notna(minimum) else None,
                "max": float(maximum) if pd.notna(maximum) else None,
                "median": float(median) if pd.notna(median) else None,
            }
        )
    for column in categorical_columns:
        unique_values = [str(value) for value in frame[column].dropna().unique()]
        schema.append(
            {
                "name": str(column),
                "kind": "categorical",
                "nullable": bool(frame[column].isna().any()),
                "values": unique_values[: ONE_HOT_MAX_CATEGORIES + 1],
                "truncated": len(unique_values) > ONE_HOT_MAX_CATEGORIES + 1,
            }
        )
    return schema


def _compute_class_weights(
    y_train: np.ndarray, class_labels: List[str]
) -> Tuple[Dict[int, float], Dict[str, int]]:
    """Pesos balanceados por clase, calculados solo con el conjunto de entrenamiento.

    Calcularlos sobre el dataset completo filtraría la distribución del test al
    entrenamiento. La fórmula es la de ``class_weight="balanced"`` de
    scikit-learn: ``n_muestras / (n_clases * frecuencia_clase)``.
    """
    from sklearn.utils.class_weight import compute_class_weight

    classes = np.unique(y_train)
    distribution = {
        (class_labels[int(index)] if int(index) < len(class_labels) else str(int(index))): int(count)
        for index, count in zip(*np.unique(y_train, return_counts=True))
    }
    try:
        weights = compute_class_weight(
            class_weight="balanced", classes=classes, y=y_train
        )
        return {int(label): float(weight) for label, weight in zip(classes, weights)}, distribution
    except ValueError:
        return {}, distribution


def prepare_dataset(
    path: Path,
    *,
    target_column: str,
    task: Optional[str] = None,
    val_split: float = 0.15,
    test_split: float = 0.15,
    random_state: int = 42,
) -> PreparedDataset:
    if not path.exists():
        raise DataPreparationError("El archivo del dataset no existe en el almacenamiento compartido")

    frame = _read_csv(path)
    if frame.empty:
        raise DataPreparationError("El CSV no contiene filas de datos")
    if len(frame) > MAX_CSV_ROWS:
        raise DataPreparationError(f"El CSV excede el máximo de {MAX_CSV_ROWS} filas")
    if frame.shape[1] < 2:
        raise DataPreparationError("El CSV debe contener al menos una característica y la columna objetivo")
    if frame.shape[1] > MAX_CSV_COLUMNS:
        raise DataPreparationError(f"El CSV excede el máximo de {MAX_CSV_COLUMNS} columnas")
    if target_column not in frame.columns:
        raise DataPreparationError(f"La columna objetivo '{target_column}' no existe en el CSV")

    frame = frame.dropna(subset=[target_column])
    if len(frame) < 10:
        raise DataPreparationError("Se requieren al menos 10 filas con la columna objetivo informada")

    duplicate_rows = int(frame.duplicated().sum())

    resolved_task = task if task in {"classification", "regression"} else _infer_task(
        frame[target_column], len(frame)
    )

    X_raw = frame.drop(columns=[target_column]).copy()
    if X_raw.shape[1] == 0:
        raise DataPreparationError("El dataset no contiene columnas de características")

    if resolved_task == "regression":
        y_series = pd.to_numeric(frame[target_column], errors="coerce")
        mask = y_series.notna()
        X_raw = X_raw.loc[mask].reset_index(drop=True)
        y_series = y_series.loc[mask].reset_index(drop=True)
        y = y_series.to_numpy(dtype=np.float32)
        class_labels: List[str] = []
        label_encoder = None
        output_units, output_activation, loss = 1, "linear", "mse"
        metrics = ["mae"]
    else:
        y_text = frame[target_column].astype(str)
        label_encoder = LabelEncoder()
        y = label_encoder.fit_transform(y_text).astype(np.int64)
        class_labels = [str(item) for item in label_encoder.classes_]
        n_classes = len(class_labels)
        if n_classes < 2:
            raise DataPreparationError("La columna objetivo debe contener al menos dos clases")
        if n_classes == 2:
            output_units, output_activation, loss = 1, "sigmoid", "binary_crossentropy"
        else:
            output_units, output_activation, loss = n_classes, "softmax", "sparse_categorical_crossentropy"
        metrics = ["accuracy"]

    if resolved_task == "classification":
        X_raw = X_raw.reset_index(drop=True)

    numeric_columns: List[str] = []
    categorical_columns: List[str] = []
    for column in X_raw.columns:
        series = X_raw[column]
        if series.notna().sum() == 0:
            continue
        if _is_numeric_like(series):
            numeric_columns.append(column)
        else:
            categorical_columns.append(column)

    if not numeric_columns and not categorical_columns:
        raise DataPreparationError("No hay columnas de características utilizables tras la limpieza")

    # Evita que SimpleImputer elimine columnas completamente vacías.
    numeric_columns = [c for c in numeric_columns if X_raw[c].notna().any()]

    input_schema = _build_input_schema(X_raw, numeric_columns, categorical_columns)

    for column in categorical_columns:
        X_raw[column] = X_raw[column].where(X_raw[column].notna(), "missing").astype(str)

    one_hot_columns = [
        c for c in categorical_columns if int(X_raw[c].nunique(dropna=True)) <= ONE_HOT_MAX_CATEGORIES
    ]
    ordinal_columns = [c for c in categorical_columns if c not in one_hot_columns]

    transformers: List[Tuple[str, Any, List[str]]] = []
    if numeric_columns:
        transformers.append(
            (
                "numeric",
                Pipeline(
                    [
                        ("imputer", SimpleImputer(strategy="median")),
                        ("scaler", StandardScaler()),
                    ]
                ),
                numeric_columns,
            )
        )
    if one_hot_columns:
        transformers.append(
            (
                "onehot",
                OneHotEncoder(handle_unknown="ignore", sparse_output=False),
                one_hot_columns,
            )
        )
    if ordinal_columns:
        transformers.append(
            (
                "ordinal",
                Pipeline(
                    [
                        ("imputer", SimpleImputer(strategy="most_frequent")),
                        (
                            "encoder",
                            OrdinalEncoder(
                                handle_unknown="use_encoded_value",
                                unknown_value=-1,
                                encoded_missing_value=-1,
                            ),
                        ),
                    ]
                ),
                ordinal_columns,
            )
        )

    preprocessor = ColumnTransformer(transformers=transformers, remainder="drop")

    X_train_raw, X_val_raw, X_test_raw, y_train, y_val, y_test, stratified = _split(
        X_raw,
        y,
        task=resolved_task,
        val_split=val_split,
        test_split=test_split,
        random_state=random_state,
    )

    X_train = preprocessor.fit_transform(X_train_raw)
    X_val = preprocessor.transform(X_val_raw)
    X_test = preprocessor.transform(X_test_raw)

    if hasattr(X_train, "toarray"):
        X_train = X_train.toarray()
        X_val = X_val.toarray()
        X_test = X_test.toarray()

    X_train = np.asarray(X_train, dtype=np.float32)
    X_val = np.asarray(X_val, dtype=np.float32)
    X_test = np.asarray(X_test, dtype=np.float32)

    if X_train.shape[1] == 0:
        raise DataPreparationError("El preprocesamiento no produjo características utilizables")
    if X_train.shape[1] > MAX_FEATURES_AFTER_ENCODING:
        raise DataPreparationError(
            f"El dataset genera {X_train.shape[1]} características tras codificar; "
            f"el máximo configurado es {MAX_FEATURES_AFTER_ENCODING}"
        )

    try:
        feature_names = [str(name) for name in preprocessor.get_feature_names_out()]
    except Exception:  # pragma: no cover - versiones antiguas de sklearn
        feature_names = [f"feature_{index}" for index in range(X_train.shape[1])]

    numeric_scaler = None
    if numeric_columns:
        numeric_pipeline = preprocessor.named_transformers_.get("numeric")
        if numeric_pipeline is not None:
            numeric_scaler = numeric_pipeline.named_steps.get("scaler")

    class_weights: Dict[int, float] = {}
    train_class_distribution: Dict[str, int] = {}
    if resolved_task == "classification":
        class_weights, train_class_distribution = _compute_class_weights(
            y_train, class_labels
        )

    return PreparedDataset(
        X_train=X_train,
        X_val=X_val,
        X_test=X_test,
        y_train=y_train,
        y_val=y_val,
        y_test=y_test,
        input_dim=int(X_train.shape[1]),
        task=resolved_task,
        target_column=target_column,
        output_units=output_units,
        output_activation=output_activation,
        loss=loss,
        metrics=metrics,
        class_labels=class_labels,
        feature_names=feature_names,
        numeric_columns=numeric_columns,
        categorical_columns=categorical_columns,
        preprocessor=preprocessor,
        numeric_scaler=numeric_scaler,
        label_encoder=label_encoder,
        samples=int(len(frame)),
        samples_train=int(len(y_train)),
        samples_val=int(len(y_val)),
        samples_test=int(len(y_test)),
        class_weights=class_weights,
        train_class_distribution=train_class_distribution,
        input_schema=input_schema,
        duplicate_rows=duplicate_rows,
        val_split=float(val_split),
        test_split=float(test_split),
        stratified=stratified,
    )


def to_dataframe(csv_bytes: bytes) -> pd.DataFrame:
    """Utilidad usada por pruebas para validar el mismo lector."""
    last_error: Optional[Exception] = None
    for encoding in ("utf-8", "utf-8-sig", "latin-1"):
        try:
            return pd.read_csv(io.BytesIO(csv_bytes), sep=None, engine="python", encoding=encoding)
        except Exception as exc:
            last_error = exc
    raise DataPreparationError(str(last_error))
