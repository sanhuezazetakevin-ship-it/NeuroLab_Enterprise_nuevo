"""Pruebas del manifiesto de entrenamiento y de la ficha del modelo."""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pandas as pd
import pytest

from manifest import build_manifest, render_model_card
from preprocessing import prepare_dataset


def _dataset(tmp_path: Path):
    rows = []
    for index in range(120):
        rows.append([index, (index * 7) % 50, 1 if index % 100 >= 50 else 0])
    path = tmp_path / "datos.csv"
    path.write_text(pd.DataFrame(rows, columns=["x1", "x2", "target"]).to_csv(index=False), encoding="utf-8")
    return prepare_dataset(path, target_column="target")


def _manifest(tmp_path: Path, *, beats_baseline: bool = True) -> dict:
    data = _dataset(tmp_path)
    project_id = uuid4()
    job_id = uuid4()
    return build_manifest(
        project_id=project_id,
        job_id=job_id,
        data=data,
        hyperparameters={"epochs": 5, "batch_size": 16, "optimizer": "adam", "random_seed": 42},
        architecture={
            "family": "FEEDFORWARD",
            "name": "Red de prueba",
            "config_json": {"input_shape": [2], "layers": [{"type": "Dense", "units": 8, "activation": "relu"}]},
        },
        dataset={
            "id": str(uuid4()),
            "name": "datos",
            "version": "v1.0",
            "checksum": "abc123",
            "original_filename": "datos.csv",
        },
        evaluation={"task": "classification", "accuracy": 0.9, "f1_score": 0.88, "roc_auc": 0.93, "decision_threshold": 0.42},
        baseline_report={"dummy_majority": {"description": "trivial", "metrics": {"f1_score": 0.5}}},
        comparison={
            "available": True,
            "metric": "f1_score",
            "model_score": 0.88,
            "best_baseline": "logistic_regression",
            "best_baseline_score": 0.74,
            "delta": 0.14,
            "beats_baseline": beats_baseline,
        },
        generalization={"available": True, "verdict": "sin sobreajuste significativo", "validation_degradation_pct": 1.2, "best_epoch": 4},
        environment={"python": "3.13.6", "packages": {"tensorflow": "2.21.0"}, "git_commit": "abc"},
        reproducibility={"random_seed": 42, "deterministic_ops": True, "python_hash_seed": "0"},
        training_summary={"epochs_completed": 5, "early_stopped": False, "best_epoch": 4, "duration_seconds": 12.5},
        artifacts={"model": "model.keras", "scaler": "scaler.pkl", "preprocessor": "preprocessor.pkl"},
        code_version="1.0.0",
    )


def test_manifest_contains_auditable_blocks(tmp_path):
    manifest = _manifest(tmp_path)

    assert manifest["schema_version"] == 2
    for key in (
        "dataset",
        "architecture",
        "training",
        "reproducibility",
        "environment",
        "evaluation_protocol",
        "metrics",
        "baselines",
        "baseline_comparison",
        "generalization",
        "artifacts",
    ):
        assert key in manifest, key

    assert manifest["dataset"]["checksum"] == "abc123"
    assert manifest["dataset"]["total_rows"] == 120
    assert manifest["evaluation_protocol"]["stratified"] is True
    assert manifest["reproducibility"]["deterministic_ops"] is True


def test_model_card_renders_all_sections(tmp_path):
    card = render_model_card(_manifest(tmp_path))

    for section in (
        "# Ficha del modelo",
        "## 1. Uso previsto",
        "## 2. Datos",
        "## 3. Arquitectura",
        "## 4. Entrenamiento",
        "## 5. Evaluación",
        "## 6. Comparación con baselines",
        "## 7. Generalización",
        "## 8. Reproducibilidad",
        "## 9. Limitaciones",
        "## 10. Trazabilidad",
    ):
        assert section in card, section

    assert "0.88" in card
    assert "logistic_regression" in card


def test_model_card_warns_when_baseline_wins(tmp_path):
    card = render_model_card(_manifest(tmp_path, beats_baseline=False))
    assert "no supera al mejor baseline" in card or "no** supera" in card
    assert "La complejidad adicional no está" in card


def test_model_card_handles_missing_optional_sections(tmp_path):
    data = _dataset(tmp_path)
    manifest = build_manifest(
        project_id=uuid4(),
        job_id=uuid4(),
        data=data,
        hyperparameters={},
        architecture={},
        dataset={},
        evaluation={},
        baseline_report={},
        comparison={},
        generalization={},
        environment={},
        reproducibility={},
        training_summary={},
        artifacts={},
        code_version="1.0.0",
    )
    card = render_model_card(manifest)
    assert "No fue posible comparar con baselines" in card
    assert "No hay historial suficiente" in card
