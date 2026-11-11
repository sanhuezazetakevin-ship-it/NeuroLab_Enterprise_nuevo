"""Pruebas de construcción del modelo y de reproducibilidad del entrenamiento."""

from __future__ import annotations

import numpy as np
import pytest

tf = pytest.importorskip("tensorflow")

from builder import KerasModelBuilder, ModelBuildError  # noqa: E402
from reproducibility import configure_determinism  # noqa: E402
from trainer import train_model  # noqa: E402

CONFIG = {
    "input_shape": [4],
    "layers": [
        {"type": "Dense", "units": 8, "activation": "relu"},
        {"type": "Dropout", "rate": 0.1},
        {"type": "Dense", "units": 4, "activation": "relu"},
    ],
}


def _build(config=None, *, seed=42, input_dim=4, family="FEEDFORWARD"):
    return KerasModelBuilder.build_model(
        config=config or CONFIG,
        family=family,
        input_dim=input_dim,
        output_units=1,
        output_activation="sigmoid",
        loss="binary_crossentropy",
        metrics=["accuracy"],
        hyperparameters={"random_seed": seed},
    )


def test_rejects_families_not_supported_for_tabular_data():
    with pytest.raises(ModelBuildError, match="no está habilitada"):
        _build(family="GAN")


def test_rejects_input_shape_mismatch():
    with pytest.raises(ModelBuildError, match="no coincide"):
        _build(input_dim=7)


def test_rejects_unsupported_layer():
    config = {"input_shape": [4], "layers": [{"type": "Attention"}]}
    with pytest.raises(ModelBuildError, match="no soportado"):
        _build(config)


def test_rejects_2d_layers_for_tabular_data():
    config = {"input_shape": [4], "layers": [{"type": "Conv2D"}]}
    with pytest.raises(ModelBuildError, match="no está soportada"):
        _build(config, family="CNN")


def test_builds_cnn_1d_for_tabular_data():
    config = {
        "input_shape": [4],
        "layers": [
            {"type": "Conv1D", "filters": 8, "kernel_size": [3], "activation": "relu"},
            {"type": "MaxPooling1D", "pool_size": [2]},
            {"type": "Flatten"},
        ],
    }
    model = _build(config, family="CNN")
    assert model.output_shape == (None, 1)


def test_output_layer_matches_task():
    model = _build()
    assert model.output_shape == (None, 1)
    assert model.layers[-1].activation.__name__ == "sigmoid"


def test_same_seed_produces_identical_initial_weights():
    first = _build(seed=123)
    second = _build(seed=123)
    for weight_a, weight_b in zip(first.get_weights(), second.get_weights()):
        assert np.allclose(weight_a, weight_b)


def test_different_seed_produces_different_weights():
    first = _build(seed=1)
    second = _build(seed=2)
    differences = [
        not np.allclose(weight_a, weight_b)
        for weight_a, weight_b in zip(first.get_weights(), second.get_weights())
    ]
    assert any(differences)


def test_configuration_reports_seed_and_determinism():
    report = configure_determinism(7, deterministic=True)
    assert report["random_seed"] == 7
    assert report["deterministic_requested"] is True
    assert report["tensorflow_available"] is True


def test_two_trainings_with_same_seed_converge_to_same_weights():
    """Prueba fuerte de reproducibilidad: mismo seed, mismos pesos finales."""
    rng = np.random.default_rng(0)
    X = rng.normal(size=(32, 4)).astype("float32")
    y = (X[:, 0] + X[:, 1] > 0).astype("float32")
    validation = (X[:8], y[:8])

    def run():
        configure_determinism(99, deterministic=True)
        model = _build(seed=99)
        outcome = train_model(
            model,
            X_train=X[8:],
            y_train=y[8:],
            X_val=validation[0],
            y_val=validation[1],
            hyperparameters={
                "epochs": 3,
                "batch_size": 8,
                "early_stopping": False,
                "reduce_lr_on_plateau": False,
                "timeout_seconds": 300,
            },
            on_epoch=lambda epoch, metrics: None,
            check_cancel=lambda: False,
        )
        assert outcome.status == "COMPLETED"
        assert outcome.epochs_completed == 3
        return model.get_weights()

    first = run()
    second = run()
    for weight_a, weight_b in zip(first, second):
        assert np.allclose(weight_a, weight_b, atol=1e-5)
