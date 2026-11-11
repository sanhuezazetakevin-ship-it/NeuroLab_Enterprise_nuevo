"""Pruebas del cálculo de métricas, umbrales y diagnóstico de generalización."""

from __future__ import annotations

import numpy as np
import pytest

from metrics import (
    classification_metrics,
    compare_with_baselines,
    generalization_gap,
    probabilities_matrix,
    regression_metrics,
)


def test_probabilities_matrix_expands_binary_output():
    raw = np.array([[0.2], [0.8]])
    matrix = probabilities_matrix(raw, output_units=1, n_classes=2)
    assert matrix.shape == (2, 2)
    assert matrix[:, 0] == pytest.approx([0.8, 0.2])
    assert matrix.sum(axis=1) == pytest.approx([1.0, 1.0])


def test_binary_metrics_with_perfect_predictions():
    y_true = np.array([0, 1, 0, 1, 1, 0])
    scores = np.array([0.05, 0.95, 0.10, 0.90, 0.80, 0.20])

    metrics = classification_metrics(
        y_true, scores, class_labels=["0", "1"], output_units=1
    )

    assert metrics["accuracy"] == pytest.approx(1.0)
    assert metrics["f1_score"] == pytest.approx(1.0)
    assert metrics["roc_auc"] == pytest.approx(1.0)
    assert metrics["pr_auc"] == pytest.approx(1.0)
    assert metrics["confusion_matrix"] == [[3, 0], [0, 3]]
    assert metrics["support"] == {"negative": 3, "positive": 3}


def test_accuracy_hides_imbalance_but_balanced_accuracy_does_not():
    y_true = np.array([0] * 80 + [1] * 20)
    scores = np.array([0.1] * 80 + [0.2] * 20)  # nunca supera 0.5

    metrics = classification_metrics(
        y_true, scores, class_labels=["0", "1"], output_units=1
    )
    reference = metrics["operating_point"]

    # El modelo acierta el 80% simplemente prediciendo la clase mayoritaria...
    assert reference["accuracy"] == pytest.approx(0.8)
    # ...pero no detecta ningún positivo y su balanced accuracy es 0.5.
    assert reference["recall"] == pytest.approx(0.0)
    assert reference["balanced_accuracy"] == pytest.approx(0.5)


def test_threshold_tuning_improves_f1():
    y_true = np.array([0, 0, 0, 0, 1, 1, 1, 1])
    scores = np.array([0.10, 0.20, 0.30, 0.40, 0.45, 0.60, 0.70, 0.90])

    metrics = classification_metrics(
        y_true, scores, class_labels=["0", "1"], output_units=1
    )

    assert metrics["operating_point"]["threshold"] == 0.5
    assert metrics["decision_threshold"] != 0.5
    assert metrics["f1_score"] >= metrics["operating_point"]["f1_score"]


def test_multiclass_metrics_include_per_class_detail():
    y_true = np.array([0, 1, 2, 0, 1, 2, 0, 1, 2])
    probabilities = np.eye(3)[y_true]

    metrics = classification_metrics(
        y_true, probabilities, class_labels=["a", "b", "c"], output_units=3
    )

    assert metrics["accuracy"] == pytest.approx(1.0)
    assert metrics["roc_auc"] == pytest.approx(1.0)
    assert metrics["decision_threshold"] is None
    assert set(metrics["per_class"]) == {"a", "b", "c"}
    assert metrics["confusion_matrix"] == [[3, 0, 0], [0, 3, 0], [0, 0, 3]]


def test_regression_metrics_exact_values():
    metrics = regression_metrics([1.0, 2.0, 3.0], [1.0, 2.0, 3.0])

    assert metrics["test_rmse"] == pytest.approx(0.0)
    assert metrics["test_mae"] == pytest.approx(0.0)
    assert metrics["r2_score"] == pytest.approx(1.0)
    assert metrics["samples"] == 3


def test_generalization_gap_detects_overfitting():
    history = {
        "loss": [1.0, 0.8, 0.6, 0.5],
        "val_loss": [1.1, 0.9, 1.2, 1.4],
    }
    gap = generalization_gap(history)

    assert gap["available"] is True
    assert gap["verdict"] == "sobreajuste"
    assert gap["best_epoch"] == 2
    assert gap["validation_degradation_pct"] > 15.0


def test_generalization_gap_without_overfitting():
    history = {"loss": [1.0, 0.8, 0.6], "val_loss": [1.1, 0.9, 0.7]}
    gap = generalization_gap(history)

    assert gap["verdict"] == "sin sobreajuste significativo"
    assert gap["validation_degradation_pct"] == pytest.approx(0.0)


def test_generalization_gap_without_history():
    assert generalization_gap({})["available"] is False


def test_comparison_against_baselines():
    model_metrics = {"f1_score": 0.82}
    baselines = {
        "dummy_majority": {"metrics": {"f1_score": 0.30}},
        "logistic_regression": {"metrics": {"f1_score": 0.74}},
    }

    comparison = compare_with_baselines(model_metrics, baselines, task="classification")

    assert comparison["available"] is True
    assert comparison["beats_baseline"] is True
    assert comparison["best_baseline"] == "logistic_regression"
    assert comparison["delta"] == pytest.approx(0.08)


def test_comparison_reports_when_baseline_wins():
    comparison = compare_with_baselines(
        {"f1_score": 0.40},
        {"logistic_regression": {"metrics": {"f1_score": 0.70}}},
        task="classification",
    )

    assert comparison["beats_baseline"] is False
    assert comparison["delta"] == pytest.approx(-0.30)


def test_comparison_without_baselines():
    assert compare_with_baselines({"f1_score": 0.5}, {}, task="classification")[
        "available"
    ] is False
