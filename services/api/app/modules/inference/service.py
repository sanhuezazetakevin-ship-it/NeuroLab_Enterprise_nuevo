"""Servicio de inferencia real sobre los artefactos entrenados.

TensorFlow y scikit-learn son dependencias pesadas (cientos de MB) que la API
no necesita para operar: solo hacen falta cuando alguien invoca ``/predict``.
Por eso se importan **dentro de este módulo y solo al usarlo**. Si no están
instaladas, el endpoint responde 503 con un mensaje explícito y el resto de la
plataforma sigue funcionando.

Consideraciones de seguridad
----------------------------
``scaler.pkl`` y ``preprocessor.pkl`` se deserializan con ``pickle``. Solo se
aceptan claves de almacenamiento bajo ``models/``, que únicamente escribe el
worker; nunca se deserializa contenido enviado por un cliente.
"""

from __future__ import annotations

import hashlib
import importlib.util
import logging
import pickle
import tempfile
import threading
from collections import OrderedDict
from pathlib import Path, PurePosixPath
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from app.core.storage import StorageError, storage

logger = logging.getLogger("neurolab.inference")

REQUIRED_PACKAGES = ("tensorflow", "sklearn")
MAX_CACHED_MODELS = 4
DEFAULT_THRESHOLD = 0.5
MAX_RECORDS_PER_REQUEST = 1000

# El worker registra los artefactos con claves lógicas ("model", "scaler"...),
# pero la carga usa el nombre real del archivo. Este mapa traduce ambas formas
# para que los checksums registrados se puedan verificar.
ARTIFACT_FILENAMES = {
    "model": "model.keras",
    "scaler": "scaler.pkl",
    "preprocessor": "preprocessor.pkl",
    "manifest": "training_manifest.json",
}


class InferenceError(RuntimeError):
    """Error controlado del servicio de inferencia."""


class InferenceUnavailable(InferenceError):
    """Faltan dependencias opcionales o el backend no puede cargar modelos."""


class ArtifactUnavailable(InferenceError):
    """El modelo o sus artefactos no están disponibles en el almacenamiento."""


class PredictionInputError(InferenceError):
    """La entrada no cumple el esquema con el que se entrenó el modelo."""


def missing_dependencies() -> List[str]:
    """Devuelve las dependencias opcionales ausentes sin importarlas."""
    missing: List[str] = []
    for package in REQUIRED_PACKAGES:
        try:
            if importlib.util.find_spec(package) is None:
                missing.append(package)
        except (ImportError, ValueError):  # pragma: no cover - especificación inválida
            missing.append(package)
    return missing


def _sibling_key(storage_key: str, filename: str) -> str:
    """Construye la clave de un artefacto hermano del modelo."""
    path = PurePosixPath((storage_key or "").replace("\\", "/"))
    if not path.name:
        raise ArtifactUnavailable("La versión de modelo no tiene un artefacto asociado")
    return (path.parent / filename).as_posix()


def _read_bytes(storage_key: str, filename: str) -> bytes:
    key = _sibling_key(storage_key, filename)
    try:
        return storage.get_bytes(key)
    except StorageError as exc:
        raise ArtifactUnavailable(
            f"El artefacto '{filename}' no está disponible para este modelo"
        ) from exc


def _expected_checksums(metrics_summary: Optional[Dict[str, Any]]) -> Dict[str, str]:
    """Normaliza los checksums registrados a claves por nombre de archivo.

    ``metrics_summary["artifacts"]`` puede venir con claves lógicas
    (``model``, ``scaler``...) o directamente con nombres de archivo. Las
    claves lógicas se traducen para que ``_load_model`` pueda compararlas.
    """
    raw_artifacts = (metrics_summary or {}).get("artifacts") or {}
    if not isinstance(raw_artifacts, dict):
        return {}

    checksums: Dict[str, str] = {}
    for name, info in raw_artifacts.items():
        if isinstance(info, dict):
            digest = info.get("sha256")
        elif isinstance(info, str):
            digest = info
        else:
            continue
        if digest:
            checksums[ARTIFACT_FILENAMES.get(str(name), str(name))] = str(digest)
    return checksums


def _verify_artifact(
    filename: str, content: bytes, expected_checksums: Optional[Dict[str, str]]
) -> None:
    """Comprueba el SHA-256 de un artefacto cuando hay un hash registrado."""
    expected_hash = (expected_checksums or {}).get(filename)
    if not expected_hash:
        return

    actual_hash = hashlib.sha256(content).hexdigest()
    if actual_hash != expected_hash:
        raise InferenceError(
            f"Integridad violada: el hash SHA-256 del artefacto {filename} no coincide "
            f"con el registrado. Esperado: {expected_hash[:12]}, Obtenido: {actual_hash[:12]}"
        )


class LoadedModel:
    """Modelo Keras con su preprocesador y metadatos de entrenamiento."""

    def __init__(
        self,
        *,
        model,
        bundle: Dict[str, Any],
        storage_key: str,
    ) -> None:
        self.model = model
        self.bundle = bundle
        self.storage_key = storage_key
        self.preprocessor = bundle.get("preprocessor")
        if self.preprocessor is None:
            raise InferenceError(
                "El paquete de artefactos no contiene el preprocesador de entrenamiento"
            )

    @property
    def task(self) -> str:
        return str(self.bundle.get("task") or "classification")

    @property
    def class_labels(self) -> List[str]:
        return [str(label) for label in (self.bundle.get("class_labels") or [])]

    @property
    def output_units(self) -> int:
        return int(self.bundle.get("output_units") or 1)


class _ModelCache:
    """Caché LRU mínima: cargar TensorFlow es caro y los artefactos son inmutables."""

    def __init__(self, max_entries: int = MAX_CACHED_MODELS) -> None:
        self._max_entries = max_entries
        self._entries: "OrderedDict[str, LoadedModel]" = OrderedDict()
        self._lock = threading.Lock()

    def get(
        self,
        storage_key: str,
        expected_checksums: Optional[Dict[str, str]] = None,
    ) -> LoadedModel:
        # La clave incluye el hash del modelo: si el artefacto cambia en el
        # almacenamiento, se recarga y se vuelve a verificar en vez de servir
        # una versión cacheada con el checksum antiguo.
        model_checksum = (expected_checksums or {}).get("model.keras")
        cache_key = f"{storage_key}|{model_checksum}" if model_checksum else storage_key
        with self._lock:
            cached = self._entries.get(cache_key)
            if cached is not None:
                self._entries.move_to_end(cache_key)
                return cached

            # Se carga dentro del lock para evitar que dos peticiones simultáneas
            # carguen TensorFlow y el modelo a la vez (duplicaría memoria).
            loaded = _load_model(storage_key, expected_checksums=expected_checksums)
            self._entries[cache_key] = loaded
            self._entries.move_to_end(cache_key)
            while len(self._entries) > self._max_entries:
                self._entries.popitem(last=False)
            return loaded

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()


_model_cache = _ModelCache()
_predict_lock = threading.Lock()


def clear_cache() -> None:
    """Vacía la caché de modelos (usado por pruebas y tras cambios de entorno)."""
    _model_cache.clear()


def _load_model(
    storage_key: str,
    expected_checksums: Optional[Dict[str, str]] = None,
) -> LoadedModel:
    missing = missing_dependencies()
    if missing:
        raise InferenceUnavailable(
            "La inferencia no está habilitada en este despliegue; faltan: "
            + ", ".join(missing)
            + ". Instale 'requirements-inference.txt' para habilitarla."
        )

    try:
        import tensorflow as tf
    except Exception as exc:  # pragma: no cover - instalación rota
        raise InferenceUnavailable(f"No fue posible importar TensorFlow: {exc}") from exc

    bundle_bytes = _read_bytes(storage_key, "scaler.pkl")
    _verify_artifact("scaler.pkl", bundle_bytes, expected_checksums)

    try:
        bundle = pickle.loads(bundle_bytes)
    except Exception as exc:
        raise InferenceError("El paquete de preprocesamiento está corrupto") from exc
    if not isinstance(bundle, dict):
        raise InferenceError("El paquete de preprocesamiento tiene un formato inesperado")

    model_bytes = _read_bytes(storage_key, "model.keras")
    _verify_artifact("model.keras", model_bytes, expected_checksums)

    try:
        with tempfile.TemporaryDirectory(prefix="neurolab_inference_") as tmp:
            model_path = Path(tmp) / "model.keras"
            model_path.write_bytes(model_bytes)
            # compile=False: la inferencia no necesita optimizador ni función de
            # pérdida, y así el modelo carga más rápido y con menos memoria.
            model = tf.keras.models.load_model(model_path, compile=False)
    except Exception as exc:
        raise InferenceError(f"No fue posible cargar el modelo Keras: {exc}") from exc

    logger.info("Modelo cargado para inferencia: %s", storage_key)
    return LoadedModel(model=model, bundle=bundle, storage_key=storage_key)


def _schema_index(bundle: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    return {
        str(item.get("name")): item
        for item in (bundle.get("input_schema") or [])
        if isinstance(item, dict) and item.get("name")
    }


def build_frame(
    records: List[Dict[str, Any]], bundle: Dict[str, Any]
) -> Tuple[pd.DataFrame, List[str]]:
    """Convierte los registros JSON a la matriz que espera el preprocesador.

    Se valida el esquema para no aceptar errores de tipeo como columnas
    ignoradas en silencio, y se generan advertencias cuando un valor categórico
    no se observó durante el entrenamiento.
    """
    if not records:
        raise PredictionInputError("Debe enviar al menos un registro")
    if len(records) > MAX_RECORDS_PER_REQUEST:
        raise PredictionInputError(
            f"El máximo de registros por petición es {MAX_RECORDS_PER_REQUEST}"
        )

    numeric_columns = [str(column) for column in (bundle.get("numeric_columns") or [])]
    categorical_columns = [str(column) for column in (bundle.get("categorical_columns") or [])]
    expected = numeric_columns + categorical_columns
    if not expected:
        raise InferenceError("El modelo no declara columnas de entrada")

    schema = _schema_index(bundle)
    categorical_values = bundle.get("categorical_values") or {}
    warnings: List[str] = []
    rows: List[Dict[str, Any]] = []

    for index, record in enumerate(records):
        if not isinstance(record, dict):
            raise PredictionInputError(f"El registro {index} debe ser un objeto JSON")

        unknown = sorted(set(record) - set(expected))
        if unknown:
            raise PredictionInputError(
                f"El registro {index} contiene campos desconocidos: "
                + ", ".join(unknown)
            )

        missing = [column for column in expected if column not in record]
        required = [
            column
            for column in missing
            if not bool(schema.get(column, {}).get("nullable", False))
        ]
        if required:
            raise PredictionInputError(
                f"El registro {index} no incluye los campos obligatorios: "
                + ", ".join(required)
            )

        row: Dict[str, Any] = {}
        for column in numeric_columns:
            value = record.get(column)
            if value is None or value == "":
                row[column] = np.nan
                continue
            if isinstance(value, bool):
                raise PredictionInputError(
                    f"El campo '{column}' del registro {index} debe ser numérico"
                )
            try:
                row[column] = float(value)
            except (TypeError, ValueError) as exc:
                raise PredictionInputError(
                    f"El campo '{column}' del registro {index} debe ser numérico"
                ) from exc
            if not np.isfinite(row[column]):
                raise PredictionInputError(
                    f"El campo '{column}' del registro {index} debe ser un número finito"
                )

        for column in categorical_columns:
            value = record.get(column)
            if value is None or (isinstance(value, float) and pd.isna(value)):
                row[column] = "missing"
                continue
            text = str(value)
            row[column] = text
            descriptor = schema.get(column, {})
            known_values = categorical_values.get(column) or []
            if known_values and not descriptor.get("truncated"):
                if text not in [str(item) for item in known_values]:
                    warnings.append(
                        f"Registro {index}: el valor '{text}' de '{column}' no se observó "
                        "durante el entrenamiento; el codificador lo tratará como categoría nueva."
                    )
        rows.append(row)

    frame = pd.DataFrame(rows, columns=expected)
    for column in numeric_columns:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    for column in categorical_columns:
        # Si la columna era opcional y no se envió, se imputa igual que en el
        # entrenamiento (``missing``) en lugar de dejar un NaN textual.
        frame[column] = frame[column].fillna("missing").astype(str)
    return frame, warnings


def _transform(loaded: LoadedModel, frame: pd.DataFrame) -> np.ndarray:
    try:
        matrix = loaded.preprocessor.transform(frame)
    except Exception as exc:
        raise PredictionInputError(
            f"Las características no pudieron transformarse: {exc}"
        ) from exc
    if hasattr(matrix, "toarray"):
        matrix = matrix.toarray()
    matrix = np.asarray(matrix, dtype=np.float32)
    if matrix.ndim != 2 or matrix.shape[0] != len(frame):
        raise InferenceError("El preprocesador devolvió una matriz con forma inesperada")
    return matrix


def _run_model(loaded: LoadedModel, matrix: np.ndarray) -> np.ndarray:
    # Keras no garantiza seguridad de hilos para todos los backends; se
    # serializa la inferencia. El cuello de botella real es el modelo, no el lock.
    with _predict_lock:
        try:
            raw = loaded.model.predict(matrix, verbose=0)
        except Exception as exc:
            raise InferenceError(f"El modelo falló durante la inferencia: {exc}") from exc
    return np.asarray(raw, dtype=float)


def _binary_predictions(
    probabilities: np.ndarray,
    loaded: LoadedModel,
    *,
    threshold: float,
) -> List[Dict[str, Any]]:
    labels = loaded.class_labels or ["0", "1"]
    positive_index = 1 if len(labels) > 1 else 0
    results: List[Dict[str, Any]] = []
    for index, score in enumerate(probabilities):
        score = float(min(1.0, max(0.0, score)))
        is_positive = score >= threshold
        label = labels[positive_index] if is_positive else labels[0]
        results.append(
            {
                "index": index,
                "prediction": label,
                "label": label,
                "probability": round(score, 6),
                "probabilities": {
                    labels[0]: round(1.0 - score, 6),
                    labels[positive_index]: round(score, 6),
                },
                "threshold": threshold,
            }
        )
    return results


def _multiclass_predictions(
    matrix: np.ndarray, loaded: LoadedModel
) -> List[Dict[str, Any]]:
    labels = loaded.class_labels
    matrix = matrix.reshape(matrix.shape[0], -1)
    results: List[Dict[str, Any]] = []
    for index, row in enumerate(matrix):
        # Si la activación de salida no fuese softmax, se normaliza para dar
        # probabilidades comparables; si la suma es 0 se usa argmax directo.
        total = float(np.sum(row))
        normalized = row / total if total > 0 else np.full_like(row, 1.0 / row.size)
        best = int(np.argmax(normalized))
        label = labels[best] if best < len(labels) else str(best)
        results.append(
            {
                "index": index,
                "prediction": label,
                "label": label,
                "probability": round(float(normalized[best]), 6),
                "probabilities": {
                    (labels[position] if position < len(labels) else str(position)): round(
                        float(value), 6
                    )
                    for position, value in enumerate(normalized)
                },
                "threshold": None,
            }
        )
    return results


def _regression_predictions(values: np.ndarray) -> List[Dict[str, Any]]:
    return [
        {"index": index, "prediction": round(float(value), 6), "label": None}
        for index, value in enumerate(values)
    ]


def predict(
    *,
    storage_key: str,
    records: List[Dict[str, Any]],
    threshold: Optional[float] = None,
    metrics_summary: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Ejecuta la inferencia y devuelve una respuesta serializable."""
    metrics_summary = metrics_summary or {}
    expected_checksums = _expected_checksums(metrics_summary)
    loaded = _model_cache.get(storage_key, expected_checksums=expected_checksums)
    frame, warnings = build_frame(records, loaded.bundle)
    matrix = _transform(loaded, frame)
    raw = _run_model(loaded, matrix)

    if loaded.task == "regression":
        if threshold is not None:
            raise PredictionInputError(
                "El umbral de decisión solo aplica a clasificación binaria"
            )
        predictions = _regression_predictions(np.asarray(raw).reshape(-1))
        decision_threshold = None
    elif loaded.output_units == 1:
        probabilities = np.asarray(raw).reshape(-1)
        if probabilities.size != len(frame):
            raise InferenceError("El modelo devolvió un número de predicciones inesperado")
        decision_threshold = (
            float(threshold)
            if threshold is not None
            else float(metrics_summary.get("decision_threshold") or DEFAULT_THRESHOLD)
        )
        predictions = _binary_predictions(
            probabilities, loaded, threshold=decision_threshold
        )
    else:
        if threshold is not None:
            raise PredictionInputError(
                "El umbral de decisión solo aplica a clasificación binaria"
            )
        predictions = _multiclass_predictions(np.asarray(raw), loaded)
        decision_threshold = None

    logger.info(
        "Inferencia ejecutada sobre %s registros (modelo %s)",
        len(predictions),
        storage_key,
    )
    return {
        "task": loaded.task,
        "target_column": loaded.bundle.get("target_column"),
        "class_labels": loaded.class_labels,
        "decision_threshold": decision_threshold,
        "predictions": predictions,
        "warnings": warnings,
    }


def read_text_artifact(storage_key: str, filename: str) -> str:
    """Lee un artefacto textual (ficha o manifiesto) del modelo."""
    content = _read_bytes(storage_key, filename)
    try:
        return content.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise InferenceError(f"El artefacto '{filename}' no está en UTF-8") from exc
