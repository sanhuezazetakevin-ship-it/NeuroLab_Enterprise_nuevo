"""Trazabilidad de artefactos: la ficha reescribe el manifiesto con la versión."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from storage import ArtifactStorageManager
from worker_config import MODEL_DIR


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_publish_model_card_returns_hashes_that_match_disk():
    directory = Path(MODEL_DIR) / "models" / "proyecto-test" / "job-test"
    directory.mkdir(parents=True, exist_ok=True)
    manifest = {
        "project_id": "proyecto-test",
        "job_id": "job-test",
        "schema_version": 2,
        "code_version": "1.0.0",
        "created_at": "2026-11-02T00:00:00Z",
        "dataset": {"name": "clientes"},
        "architecture": {"name": "MLP"},
        "training": {"epochs_completed": 1},
        "metrics": {"task": "classification"},
    }

    published = ArtifactStorageManager.publish_model_card(
        artifact_dir=str(directory), manifest=manifest, version="v1.7"
    )

    final_manifest_path = Path(MODEL_DIR) / published["manifest"]["path"]
    card_path = Path(MODEL_DIR) / published["model_card"]["path"]
    final_manifest = json.loads(final_manifest_path.read_text(encoding="utf-8"))

    assert final_manifest["model_version"] == "v1.7"
    assert card_path.exists()
    assert published["manifest"]["sha256"] == _sha256(final_manifest_path)
    assert published["model_card"]["sha256"] == _sha256(card_path)
    assert "**Versión del modelo:** `v1.7`" in card_path.read_text(encoding="utf-8")
