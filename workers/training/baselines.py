"""Baselines de referencia para validar que la red neuronal aporta valor.

Un resultado de accuracy o R² no es interpretable por sí solo: hay que
compararlo con lo que se obtendría **sin** aprendizaje. Se calculan dos
referencias sobre el mismo ``X_train`` transformado y se evalúan con la misma
función de métricas que el modelo:

* **dummy**: predice siempre la clase mayoritaria (clasificación) o la media
  (regresión). Es la línea base trivial.
* **linear**: regresión logística / lineal sobre las mismas características.
  Es la línea base "clásica": si la red no la supera, la complejidad no está
  justificada.

Este bloque es el que permite responder con datos a la pregunta "¿y por qué
una red neuronal y no un modelo simple?".
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any, Dict

from sklearn.dummy import DummyClassifier, DummyRegressor
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.neighbors import KNeighborsClassifier, KNeighborsRegressor

from metrics import classification_metrics, regression_metrics

if TYPE_CHECKING:
    import numpy as np

logger = logging.getLogger("neurolab.baselines")


def _classification_baselines(
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_test: np.ndarray,
    y_test: np.ndarray,
    *,
    class_labels: list[str],
    output_units: int,
    random_state: int,
) -> Dict[str, Any]:
    report: Dict[str, Any] = {}
    n_samples = len(X_train)
    k_neighbors = min(5, max(1, n_samples - 1))
    candidates = {
        "dummy_majority": (
            "Clase mayoritaria (sin aprendizaje)",
            DummyClassifier(strategy="most_frequent"),
        ),
        "logistic_regression": (
            "Regresión logística (modelo lineal de referencia)",
            LogisticRegression(
                max_iter=2000,
                class_weight="balanced",
                random_state=random_state,
            ),
        ),
        "knn": (
            f"k-Nearest Neighbors (k={k_neighbors}, modelo no paramétrico)",
            KNeighborsClassifier(n_neighbors=k_neighbors),
        ),
    }
    for name, (description, estimator) in candidates.items():
        try:
            estimator.fit(X_train, y_train)
            probabilities = estimator.predict_proba(X_test)
            metrics = classification_metrics(
                y_test,
                probabilities,
                class_labels=class_labels,
                output_units=output_units,
            )
            report[name] = {"description": description, "metrics": metrics}
        except Exception as exc:  # el baseline no debe tumbar el entrenamiento
            logger.warning("Baseline %s no pudo calcularse: %s", name, exc)
            report[name] = {"description": description, "error": str(exc)}
    return report


def _regression_baselines(
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_test: np.ndarray,
    y_test: np.ndarray,
) -> Dict[str, Any]:
    report: Dict[str, Any] = {}
    n_samples = len(X_train)
    k_neighbors = min(5, max(1, n_samples - 1))
    candidates = {
        "dummy_mean": ("Media del objetivo (sin aprendizaje)", DummyRegressor(strategy="mean")),
        "linear_regression": (
            "Regresión lineal (modelo lineal de referencia)",
            LinearRegression(),
        ),
        "knn": (
            f"k-Nearest Neighbors (k={k_neighbors}, modelo no paramétrico)",
            KNeighborsRegressor(n_neighbors=k_neighbors),
        ),
    }
    for name, (description, estimator) in candidates.items():
        try:
            estimator.fit(X_train, y_train)
            predictions = estimator.predict(X_test)
            report[name] = {
                "description": description,
                "metrics": regression_metrics(y_test, predictions),
            }
        except Exception as exc:
            logger.warning("Baseline %s no pudo calcularse: %s", name, exc)
            report[name] = {"description": description, "error": str(exc)}
    return report


def compute_baselines(data, *, random_state: int = 42) -> Dict[str, Any]:
    """Calcula las referencias sobre el mismo split que usa el modelo."""
    if data.task == "classification":
        return _classification_baselines(
            data.X_train,
            data.y_train,
            data.X_test,
            data.y_test,
            class_labels=list(data.class_labels),
            output_units=data.output_units,
            random_state=random_state,
        )
    return _regression_baselines(
        data.X_train, data.y_train, data.X_test, data.y_test
    )


def class_balance_warning(class_weights: Dict[int, float], distribution: Dict[str, int]) -> str | None:
    """Genera una advertencia legible si el desbalance es relevante."""
    counts = [value for value in distribution.values() if value > 0]
    total = sum(counts)
    if not counts or total == 0:
        return None
    largest = max(counts)
    smallest = min(counts)
    if largest / total >= 0.9:
        return (
            "Desbalance severo: la clase mayoritaria concentra "
            f"{largest / total:.1%} de las filas. Interprete accuracy con cautela "
            "y revise precision/recall por clase."
        )
    if len(counts) > 1 and largest / smallest >= 2.0:
        return (
            "Clases desbalanceadas (ratio "
            f"{largest / smallest:.1f}:1): se aplicó peso balanceado en el entrenamiento."
        )
    return None


def weights_to_json(class_weights: Dict[int, float], class_labels: list[str]) -> Dict[str, float]:
    """Traduce los pesos de Keras (por índice) a nombres de clase legibles."""
    result: Dict[str, float] = {}
    for index, weight in class_weights.items():
        label = class_labels[index] if 0 <= index < len(class_labels) else str(index)
        result[str(label)] = float(weight)
    return result


def describe_dataset(data) -> Dict[str, Any]:
    """Resumen del dataset usado en el entrenamiento, para el model card."""
    return {
        "total_rows": int(data.samples),
        "train_rows": int(data.samples_train),
        "validation_rows": int(data.samples_val),
        "test_rows": int(data.samples_test),
        "features_input": int(data.input_dim),
        "numeric_columns": list(data.numeric_columns),
        "categorical_columns": list(data.categorical_columns),
        "duplicate_rows": int(getattr(data, "duplicate_rows", 0)),
        "class_weights": weights_to_json(data.class_weights, list(data.class_labels)),
        "class_distribution": dict(getattr(data, "train_class_distribution", {})),
        "class_balance_warning": class_balance_warning(
            data.class_weights, dict(getattr(data, "train_class_distribution", {}))
        ),
    }
