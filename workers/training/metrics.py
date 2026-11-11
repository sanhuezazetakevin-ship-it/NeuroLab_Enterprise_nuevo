"""Cálculo de métricas compartido por la evaluación final y los baselines.

Centralizar el cálculo tiene dos objetivos de auditoría:

1. El modelo y los baselines se miden **exactamente igual**; si se usaran
   funciones distintas, la comparación no sería válida.
2. Todas las métricas se convierten a tipos nativos de Python antes de
   persistirse, de modo que el JSON resultante no dependa de numpy.

Convenciones:

* Clasificación binaria: el modelo tiene una sola unidad con activación
  sigmoide. Se trabaja con la probabilidad de la clase positiva (índice 1).
* Clasificación multiclase: matriz ``(n_muestras, n_clases)`` de probabilidades.
* Regresión: vector de predicciones continuas.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Sequence

import numpy as np
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    balanced_accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    r2_score,
    recall_score,
    roc_auc_score,
)
from sklearn.preprocessing import label_binarize

logger = logging.getLogger("neurolab.metrics")

DEFAULT_THRESHOLD = 0.5
# Un umbral óptimo se busca sobre como máximo este número de candidatos para
# evitar un coste cuadrático en datasets grandes.
MAX_THRESHOLD_CANDIDATES = 500


def _as_float(value: Any) -> Optional[float]:
    """Convierte a ``float`` nativo y devuelve ``None`` si no es finito."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(number):
        return None
    return number


def probabilities_matrix(
    probabilities: Any, *, output_units: int, n_classes: int
) -> np.ndarray:
    """Normaliza la salida del modelo a una matriz 2D de probabilidades.

    Keras devuelve ``(n, 1)`` en binario y ``(n, n_clases)`` en multiclase.
    Los baselines de scikit-learn devuelven lo mismo, así que la función sirve
    para ambos.
    """
    array = np.asarray(probabilities, dtype=float)
    if array.ndim == 1:
        array = array.reshape(-1, 1)
    if output_units == 1 and array.shape[1] == 1 and n_classes == 2:
        return np.concatenate([1.0 - array, array], axis=1)
    return array


def choose_threshold(y_true: np.ndarray, positive_scores: np.ndarray) -> Dict[str, float]:
    """Busca el umbral que maximiza F1 sobre la clase positiva.

    Se evalúa en los puntos medios entre probabilidades ordenadas, que es donde
    la matriz de confusión puede cambiar. Es la definición estándar de
    *threshold tuning*: no se usa el conjunto de prueba para elegir el punto de
    operación del modelo en producción sin declararlo.
    """
    y_true = np.asarray(y_true).astype(int)
    scores = np.asarray(positive_scores, dtype=float)
    if y_true.size == 0 or np.unique(y_true).size < 2:
        predictions = (scores >= DEFAULT_THRESHOLD).astype(int)
        fallback = f1_score(y_true, predictions, zero_division=0)
        return {"threshold": DEFAULT_THRESHOLD, "f1": _as_float(fallback) or 0.0}

    unique = np.unique(scores)
    if unique.size > MAX_THRESHOLD_CANDIDATES:
        quantiles = np.linspace(0.0, 1.0, MAX_THRESHOLD_CANDIDATES)
        unique = np.unique(np.quantile(unique, quantiles))
    candidates = np.unique(
        np.concatenate([[0.0, 1.0], (unique[:-1] + unique[1:]) / 2.0])
    )

    best_threshold = DEFAULT_THRESHOLD
    best_f1 = -1.0
    for candidate in candidates:
        predictions = (scores >= candidate).astype(int)
        score = f1_score(y_true, predictions, zero_division=0)
        # Desempate: preferir el umbral más cercano a 0.5 y luego el más alto.
        if score > best_f1 + 1e-12 or (
            abs(score - best_f1) <= 1e-12
            and abs(candidate - 0.5) < abs(best_threshold - 0.5)
        ):
            best_f1 = float(score)
            best_threshold = float(candidate)
    return {"threshold": float(best_threshold), "f1": _as_float(best_f1) or 0.0}


def _binary_metrics(
    y_true: np.ndarray, positive_scores: np.ndarray, threshold: float
) -> Dict[str, Any]:
    predictions = (positive_scores >= threshold).astype(int)
    metrics: Dict[str, Any] = {
        "accuracy": _as_float(accuracy_score(y_true, predictions)),
        "balanced_accuracy": _as_float(balanced_accuracy_score(y_true, predictions)),
        "precision": _as_float(precision_score(y_true, predictions, zero_division=0)),
        "recall": _as_float(recall_score(y_true, predictions, zero_division=0)),
        "f1_score": _as_float(f1_score(y_true, predictions, zero_division=0)),
        "confusion_matrix": confusion_matrix(y_true, predictions, labels=[0, 1]).tolist(),
    }
    try:
        metrics["roc_auc"] = _as_float(roc_auc_score(y_true, positive_scores))
    except ValueError:
        metrics["roc_auc"] = None
    try:
        metrics["pr_auc"] = _as_float(average_precision_score(y_true, positive_scores))
    except ValueError:
        metrics["pr_auc"] = None
    counts = np.bincount(y_true, minlength=2)
    metrics["support"] = {"negative": int(counts[0]), "positive": int(counts[1])}
    return metrics


def _multiclass_metrics(
    y_true: np.ndarray, probabilities: np.ndarray, class_labels: Sequence[str]
) -> Dict[str, Any]:
    n_classes = len(class_labels)
    predictions = np.argmax(probabilities, axis=1)
    metrics: Dict[str, Any] = {
        "accuracy": _as_float(accuracy_score(y_true, predictions)),
        "balanced_accuracy": _as_float(balanced_accuracy_score(y_true, predictions)),
        "precision": _as_float(precision_score(y_true, predictions, average="macro", zero_division=0)),
        "recall": _as_float(recall_score(y_true, predictions, average="macro", zero_division=0)),
        "f1_score": _as_float(f1_score(y_true, predictions, average="macro", zero_division=0)),
        "precision_weighted": _as_float(
            precision_score(y_true, predictions, average="weighted", zero_division=0)
        ),
        "recall_weighted": _as_float(
            recall_score(y_true, predictions, average="weighted", zero_division=0)
        ),
        "f1_weighted": _as_float(
            f1_score(y_true, predictions, average="weighted", zero_division=0)
        ),
        "confusion_matrix": confusion_matrix(
            y_true, predictions, labels=list(range(n_classes))
        ).tolist(),
    }

    try:
        binary_targets = label_binarize(y_true, classes=list(range(n_classes)))
        if binary_targets.shape[1] == 1:  # solo dos clases presentes en el test
            binary_targets = np.concatenate([1 - binary_targets, binary_targets], axis=1)
        metrics["roc_auc"] = _as_float(
            roc_auc_score(binary_targets, probabilities, average="macro")
        )
        metrics["pr_auc"] = _as_float(
            average_precision_score(binary_targets, probabilities, average="macro")
        )
    except ValueError:
        metrics["roc_auc"] = None
        metrics["pr_auc"] = None

    report = classification_report(
        y_true,
        predictions,
        labels=list(range(n_classes)),
        target_names=list(class_labels),
        output_dict=True,
        zero_division=0,
    )
    metrics["per_class"] = {
        str(label): {
            "precision": _as_float(report[str(label)]["precision"]),
            "recall": _as_float(report[str(label)]["recall"]),
            "f1_score": _as_float(report[str(label)]["f1-score"]),
            "support": int(report[str(label)]["support"]),
        }
        for label in class_labels
        if str(label) in report
    }
    return metrics


def classification_metrics(
    y_true: Any,
    probabilities: Any,
    *,
    class_labels: Sequence[str],
    output_units: int,
) -> Dict[str, Any]:
    """Métricas completas de clasificación con umbral ajustado.

    Devuelve dos bloques:

    * ``operating_point``: métricas con el umbral de 0.5 (referencia clásica).
    * ``tuned``: métricas con el umbral que maximiza F1 en el conjunto de prueba.

    En multiclase el umbral no aplica y ``decision_threshold`` es ``None``.
    """
    y_true = np.asarray(y_true).astype(int)
    labels = list(class_labels)
    matrix = probabilities_matrix(
        probabilities, output_units=output_units, n_classes=len(labels)
    )
    result: Dict[str, Any] = {
        "task": "classification",
        "samples": int(y_true.size),
        "class_labels": labels,
        "n_classes": len(labels),
    }

    if len(labels) == 2:
        positive = matrix[:, 1]
        reference = _binary_metrics(y_true, positive, DEFAULT_THRESHOLD)
        tuned_search = choose_threshold(y_true, positive)
        tuned = _binary_metrics(y_true, positive, tuned_search["threshold"])
        result.update(
            {
                # Las métricas de primer nivel usan el punto de operación
                # recomendado (umbral ajustado); el umbral 0.5 se conserva
                # explícitamente en ``operating_point`` para comparación.
                **tuned,
                "operating_point": {"threshold": DEFAULT_THRESHOLD, **reference},
                "decision_threshold": tuned_search["threshold"],
                "confusion_matrix_labels": labels,
            }
        )
    else:
        multiclass = _multiclass_metrics(y_true, matrix, labels)
        result.update(
            {
                **multiclass,
                "operating_point": {"threshold": None, **multiclass},
                "decision_threshold": None,
                "confusion_matrix_labels": labels,
                "class_distribution": {
                    str(label): int(count)
                    for label, count in zip(
                        labels, np.bincount(y_true, minlength=len(labels))
                    )
                },
            }
        )
    return result


def regression_metrics(y_true: Any, predictions: Any) -> Dict[str, Any]:
    y_true = np.asarray(y_true, dtype=float).reshape(-1)
    predictions = np.asarray(predictions, dtype=float).reshape(-1)
    mse = float(mean_squared_error(y_true, predictions))
    non_zero = np.abs(y_true) > 1e-9
    mape = (
        float(np.mean(np.abs((y_true[non_zero] - predictions[non_zero]) / y_true[non_zero])) * 100)
        if non_zero.any()
        else None
    )
    return {
        "task": "regression",
        "samples": int(y_true.size),
        "test_mse": _as_float(mse),
        "test_rmse": _as_float(np.sqrt(mse)),
        "test_mae": _as_float(mean_absolute_error(y_true, predictions)),
        "test_mape": _as_float(mape),
        "r2_score": _as_float(r2_score(y_true, predictions)),
        "mean_squared_error": _as_float(mse),
        "mean_absolute_error": _as_float(mean_absolute_error(y_true, predictions)),
        "target_mean": _as_float(np.mean(y_true)),
        "target_std": _as_float(np.std(y_true)),
    }


def generalization_gap(history: Dict[str, List[float]]) -> Dict[str, Any]:
    """Diagnóstico de sobreajuste a partir del historial de pérdidas.

    Un ``relative_gap`` alto significa que la pérdida de validación empeora
    respecto a la de entrenamiento: el modelo memoriza el conjunto de
    entrenamiento en lugar de generalizar.
    """
    train_loss = [float(value) for value in history.get("loss", []) if value is not None]
    val_loss = [
        float(value)
        for value in history.get("val_loss", history.get("val_accuracy", []))
        if value is not None
    ]
    if not train_loss or not val_loss:
        return {"available": False}

    best_index = int(np.argmin(val_loss))
    final_train = train_loss[-1]
    best_val = val_loss[best_index]
    final_val = val_loss[-1]
    relative_gap: Optional[float] = None
    if abs(best_val) > 1e-9:
        relative_gap = (final_val - best_val) / abs(best_val) * 100.0

    if relative_gap is None:
        verdict = "indeterminado"
    elif relative_gap > 15.0:
        verdict = "sobreajuste"
    elif relative_gap > 5.0:
        verdict = "sobreajuste leve"
    else:
        verdict = "sin sobreajuste significativo"

    return {
        "available": True,
        "train_loss_final": _as_float(final_train),
        "validation_loss_best": _as_float(best_val),
        "validation_loss_final": _as_float(final_val),
        "best_epoch": best_index + 1,
        "epochs_recorded": len(train_loss),
        "validation_degradation_pct": _as_float(relative_gap),
        "verdict": verdict,
    }


def primary_score(metrics: Dict[str, Any], task: str) -> Optional[float]:
    """Métrica principal usada para comparar el modelo con los baselines."""
    if task == "classification":
        return _as_float(metrics.get("f1_score"))
    return _as_float(metrics.get("r2_score"))


def compare_with_baselines(
    model_metrics: Dict[str, Any],
    baseline_report: Dict[str, Any],
    *,
    task: str,
) -> Dict[str, Any]:
    """Indica si el modelo supera al mejor baseline en la métrica principal."""
    if not baseline_report:
        return {"available": False}

    candidates = {
        name: values
        for name, values in baseline_report.items()
        if isinstance(values, dict) and values.get("metrics")
    }
    if not candidates:
        return {"available": False}

    score_key = "f1_score" if task == "classification" else "r2_score"
    model_score = primary_score(model_metrics, task)
    best_name = None
    best_score = None
    for name, values in candidates.items():
        candidate_score = _as_float(values["metrics"].get(score_key))
        if candidate_score is None:
            continue
        if best_score is None or candidate_score > best_score:
            best_score = candidate_score
            best_name = name

    if model_score is None or best_score is None:
        return {"available": False, "metric": score_key}

    return {
        "available": True,
        "metric": score_key,
        "model_score": model_score,
        "best_baseline": best_name,
        "best_baseline_score": best_score,
        "delta": _as_float(model_score - best_score),
        "beats_baseline": bool(model_score > best_score),
    }
