"""Pruebas del pipeline de datos: tipos, nulos, desbalance y fuga de información."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from preprocessing import DataPreparationError, _split, prepare_dataset


def _write_csv(path: Path, header: list[str], rows: list[list[object]]) -> Path:
    frame = pd.DataFrame(rows, columns=header)
    path.write_text(frame.to_csv(index=False), encoding="utf-8")
    return path


def _binary_imbalanced(path: Path) -> Path:
    rows = []
    for index in range(200):
        age = 18 + (index % 45)
        income = 25000 + (index * 137) % 70000
        city = ["Lima", "Arequipa", "Cusco"][index % 3] if index % 17 else None
        # Aproximadamente 18% de casos positivos: desbalance realista.
        target = 1 if (index % 11 < 2) else 0
        rows.append([age, income, city, target])
    return _write_csv(path, ["edad", "ingreso", "ciudad", "abandono"], rows)


def _regression(path: Path) -> Path:
    rows = []
    rng = np.random.default_rng(7)
    for index in range(150):
        size = 40 + index
        rooms = 1 + (index % 4)
        price = 25000 + 1800 * size + 9000 * rooms + float(rng.normal(0, 1200))
        rows.append([size, rooms, round(price, 2)])
    return _write_csv(path, ["metros", "habitaciones", "precio"], rows)


def _multiclass(path: Path) -> Path:
    rows = []
    levels = ["bajo", "medio", "alto"]
    for index in range(180):
        score = index % 30
        level = levels[min(2, score // 10)]
        rows.append([index, score, level])
    return _write_csv(path, ["id_cliente", "puntaje", "nivel"], rows)


def test_binary_classification_detects_task_and_schema(tmp_path):
    csv_path = _binary_imbalanced(tmp_path / "churn.csv")
    data = prepare_dataset(csv_path, target_column="abandono")

    assert data.task == "classification"
    assert data.output_units == 1
    assert data.output_activation == "sigmoid"
    assert data.loss == "binary_crossentropy"
    assert data.class_labels == ["0", "1"]
    assert data.samples_train + data.samples_val + data.samples_test == data.samples
    assert data.stratified is True

    # Sin valores ausentes tras el preprocesamiento.
    assert not np.isnan(data.X_train).any()
    assert not np.isnan(data.X_test).any()
    assert data.X_train.shape[1] == data.input_dim


def test_class_weights_compensate_imbalance(tmp_path):
    csv_path = _binary_imbalanced(tmp_path / "churn.csv")
    data = prepare_dataset(csv_path, target_column="abandono")

    assert set(data.class_weights) == {0, 1}
    # La clase minoritaria debe recibir un peso mayor.
    assert data.class_weights[1] > data.class_weights[0]

    distribution = data.train_class_distribution
    assert set(distribution) == {"0", "1"}
    assert sum(distribution.values()) == data.samples_train

    # Fórmula balanced: n / (n_clases * frecuencia_de_la_clase).
    expected_minority = data.samples_train / (2 * distribution["1"])
    assert data.class_weights[1] == pytest.approx(expected_minority, rel=1e-6)


def test_input_schema_describes_original_columns(tmp_path):
    csv_path = _binary_imbalanced(tmp_path / "churn.csv")
    data = prepare_dataset(csv_path, target_column="abandono")

    schema = {item["name"]: item for item in data.input_schema}
    assert set(schema) == {"edad", "ingreso", "ciudad"}
    assert schema["edad"]["kind"] == "numeric"
    assert schema["edad"]["min"] <= schema["edad"]["median"] <= schema["edad"]["max"]
    assert schema["ciudad"]["kind"] == "categorical"
    assert set(schema["ciudad"]["values"]) <= {"Lima", "Arequipa", "Cusco", "missing"}


def test_preprocessor_is_fit_only_on_training_partition(tmp_path):
    """El escalador no debe ver el conjunto de prueba (prevención de fuga)."""
    csv_path = _binary_imbalanced(tmp_path / "churn.csv")
    data = prepare_dataset(csv_path, target_column="abandono")

    frame = pd.read_csv(csv_path)
    X_raw = frame.drop(columns=["abandono"])
    y = frame["abandono"].to_numpy()
    X_train_raw, _, _, _, _, _, _ = _split(
        X_raw, y, task="classification", val_split=0.15, test_split=0.15, random_state=42
    )

    expected_train_mean = float(pd.to_numeric(X_train_raw["edad"]).mean())
    global_mean = float(pd.to_numeric(X_raw["edad"]).mean())

    assert data.numeric_scaler is not None
    assert float(data.numeric_scaler.mean_[0]) == pytest.approx(expected_train_mean)
    # Si se hubiese ajustado con todo el dataset, coincidiría con la media global.
    assert not np.isclose(data.numeric_scaler.mean_[0], global_mean)


def test_regression_detection(tmp_path):
    csv_path = _regression(tmp_path / "precios.csv")
    data = prepare_dataset(csv_path, target_column="precio")

    assert data.task == "regression"
    assert data.output_units == 1
    assert data.output_activation == "linear"
    assert data.loss == "mse"
    assert data.class_weights == {}
    assert data.class_labels == []
    assert data.input_dim == 2


def test_multiclass_detection(tmp_path):
    csv_path = _multiclass(tmp_path / "niveles.csv")
    data = prepare_dataset(csv_path, target_column="nivel")

    assert data.task == "classification"
    assert data.output_units == 3
    assert data.output_activation == "softmax"
    assert data.loss == "sparse_categorical_crossentropy"
    assert data.class_labels == ["alto", "bajo", "medio"]
    assert data.class_weights  # tres pesos, uno por clase
    assert len(data.class_weights) == 3


def test_scaler_bundle_is_serializable_and_versioned(tmp_path):
    csv_path = _binary_imbalanced(tmp_path / "churn.csv")
    data = prepare_dataset(csv_path, target_column="abandono")

    bundle = data.scaler_bundle()
    assert bundle["version"] == 2
    assert bundle["preprocessor"] is not None
    assert bundle["numeric_columns"] == ["edad", "ingreso"]
    assert bundle["categorical_columns"] == ["ciudad"]
    assert set(bundle["categorical_values"]["ciudad"]) <= {"Lima", "Arequipa", "Cusco"}
    assert bundle["output_units"] == 1


def test_single_class_target_is_rejected(tmp_path):
    rows = [[index, 1] for index in range(40)]
    csv_path = _write_csv(tmp_path / "uno.csv", ["x", "target"], rows)

    with pytest.raises(DataPreparationError, match="al menos dos clases"):
        prepare_dataset(csv_path, target_column="target")


def test_too_few_rows_is_rejected(tmp_path):
    rows = [[index, index % 2] for index in range(5)]
    csv_path = _write_csv(tmp_path / "pocas.csv", ["x", "target"], rows)

    with pytest.raises(DataPreparationError, match="al menos 10 filas"):
        prepare_dataset(csv_path, target_column="target")


def test_missing_target_column_is_rejected(tmp_path):
    csv_path = _binary_imbalanced(tmp_path / "churn.csv")
    with pytest.raises(DataPreparationError, match="no existe"):
        prepare_dataset(csv_path, target_column="columna_inexistente")
