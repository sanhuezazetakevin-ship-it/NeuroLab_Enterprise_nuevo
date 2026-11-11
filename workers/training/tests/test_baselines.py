"""Pruebas de los baselines de referencia y del resumen del dataset."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from baselines import class_balance_warning, compute_baselines, describe_dataset, weights_to_json
from metrics import compare_with_baselines
from preprocessing import prepare_dataset


def _write(path: Path, rows: list[list[object]], header: list[str]) -> Path:
    path.write_text(pd.DataFrame(rows, columns=header).to_csv(index=False), encoding="utf-8")
    return path


def _separable_binary(path: Path) -> Path:
    rows = []
    for index in range(120):
        x1 = index % 100
        x2 = (index * 7) % 50
        target = 1 if x1 >= 50 else 0
        rows.append([x1, x2, target])
    return _write(path, rows, ["x1", "x2", "target"])


def _regression(path: Path) -> Path:
    rows = [[index, index * 3 + 5] for index in range(120)]
    return _write(path, rows, ["x", "target"])


def test_classification_baselines_are_computed(tmp_path):
    data = prepare_dataset(_separable_binary(tmp_path / "sep.csv"), target_column="target")
    report = compute_baselines(data, random_state=42)

    assert set(report) == {"dummy_majority", "logistic_regression", "knn"}
    for name in report:
        assert "metrics" in report[name], report[name]
        assert report[name]["metrics"]["task"] == "classification"

    # El modelo lineal debe superar claramente al trivial en un problema separable.
    assert (
        report["logistic_regression"]["metrics"]["f1_score"]
        > report["dummy_majority"]["metrics"]["f1_score"]
    )


def test_regression_baselines_are_computed(tmp_path):
    data = prepare_dataset(_regression(tmp_path / "reg.csv"), target_column="target")
    report = compute_baselines(data, random_state=42)

    assert set(report) == {"dummy_mean", "linear_regression", "knn"}
    assert report["linear_regression"]["metrics"]["r2_score"] > 0.9
    # Predecir la media no explica nada del objetivo (R² nulo o negativo).
    assert report["dummy_mean"]["metrics"]["r2_score"] <= 0.05


def test_comparison_marks_model_that_beats_baselines(tmp_path):
    data = prepare_dataset(_separable_binary(tmp_path / "sep.csv"), target_column="target")
    report = compute_baselines(data, random_state=42)

    # En un problema perfectamente separable el baseline lineal alcanza F1=1.0.
    tie = compare_with_baselines({"f1_score": 1.0}, report, task="classification")
    assert tie["available"] is True
    assert tie["best_baseline"] == "logistic_regression"
    # Un empate no cuenta como superar al baseline.
    assert tie["beats_baseline"] is False
    assert tie["delta"] == pytest.approx(0.0)

    weaker = {"logistic_regression": {"metrics": {"f1_score": 0.50}}}
    better = compare_with_baselines({"f1_score": 0.99}, weaker, task="classification")
    assert better["beats_baseline"] is True


def test_describe_dataset_includes_weights_and_schema(tmp_path):
    data = prepare_dataset(_separable_binary(tmp_path / "sep.csv"), target_column="target")
    description = describe_dataset(data)

    assert description["total_rows"] == data.samples
    assert description["numeric_columns"] == ["x1", "x2"]
    assert description["categorical_columns"] == []
    assert set(description["class_weights"]) == {"0", "1"}
    assert sum(description["class_distribution"].values()) == data.samples_train


def test_class_balance_warning_levels():
    assert "severo" in class_balance_warning({}, {"0": 5, "1": 95})
    assert "desbalanceadas" in class_balance_warning({}, {"0": 30, "1": 70})
    assert class_balance_warning({}, {"0": 55, "1": 45}) is None


def test_weights_to_json_uses_class_labels():
    result = weights_to_json({0: 0.5, 1: 1.5}, ["no", "si"])
    assert result == {"no": 0.5, "si": 1.5}
