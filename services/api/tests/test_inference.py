"""Pruebas de la inferencia: contrato HTTP, validación y lógica de predicción.

No requieren TensorFlow: la lógica de predicción se prueba con un modelo
sustituto y un preprocesador real de scikit-learn. El camino 503 se prueba
simulando dependencias ausentes, que es exactamente lo que ocurre en un
despliegue donde no se instaló ``requirements-inference.txt``.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from uuid import UUID, uuid4

import numpy as np
import pandas as pd
import pytest
from httpx import AsyncClient
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.modules.inference import service as inference
from app.repositories.models import ModelVersionModel

TRAINING_FRAME = pd.DataFrame(
    {
        "edad": [20, 30, 40, 50, 60, 70],
        "ingreso": [1000, 2000, 3000, 4000, 5000, 6000],
        "ciudad": ["Lima", "Lima", "Cusco", "Cusco", "Lima", "Cusco"],
    }
)


@pytest.fixture(autouse=True)
def _clear_inference_cache():
    inference.clear_cache()
    yield
    inference.clear_cache()


def _preprocessor() -> ColumnTransformer:
    pipeline = ColumnTransformer(
        transformers=[
            (
                "numeric",
                Pipeline(
                    [
                        ("imputer", SimpleImputer(strategy="median")),
                        ("scaler", StandardScaler()),
                    ]
                ),
                ["edad", "ingreso"],
            ),
            (
                "onehot",
                OneHotEncoder(handle_unknown="ignore", sparse_output=False),
                ["ciudad"],
            ),
        ]
    )
    pipeline.fit(TRAINING_FRAME)
    return pipeline


def _bundle(*, task: str = "classification", class_labels=None, output_units: int = 1) -> dict:
    return {
        "version": 2,
        "task": task,
        "target_column": "abandono",
        "numeric_columns": ["edad", "ingreso"],
        "categorical_columns": ["ciudad"],
        "categorical_values": {"ciudad": ["Lima", "Cusco"]},
        "input_schema": [
            {"name": "edad", "kind": "numeric", "nullable": False, "min": 20, "max": 70, "median": 45},
            {"name": "ingreso", "kind": "numeric", "nullable": False, "min": 1000, "max": 6000, "median": 3500},
            {"name": "ciudad", "kind": "categorical", "nullable": False, "values": ["Lima", "Cusco"], "truncated": False},
        ],
        "class_labels": class_labels if class_labels is not None else ["0", "1"],
        "output_units": output_units,
        "output_activation": "sigmoid" if output_units == 1 else "softmax",
        "loss": "binary_crossentropy",
        "preprocessor": _preprocessor(),
    }


def _loaded(probabilities, *, bundle=None, storage_key="models/p/j/model.keras") -> inference.LoadedModel:
    class StubModel:
        def predict(self, matrix, verbose=0):
            return np.asarray(probabilities, dtype=float)

    return inference.LoadedModel(
        model=StubModel(),
        bundle=bundle or _bundle(),
        storage_key=storage_key,
    )


def test_build_frame_accepts_complete_records():
    frame, warnings = inference.build_frame(
        [{"edad": 42, "ingreso": 3500, "ciudad": "Lima"}], _bundle()
    )

    assert list(frame.columns) == ["edad", "ingreso", "ciudad"]
    assert frame.loc[0, "edad"] == 42
    assert warnings == []


def test_build_frame_rejects_unknown_fields():
    with pytest.raises(inference.PredictionInputError, match="campos desconocidos"):
        inference.build_frame(
            [{"edad": 42, "ingreso": 3500, "ciudad": "Lima", "tipo": "pyme"}],
            _bundle(),
        )


def test_build_frame_rejects_missing_required_fields():
    with pytest.raises(inference.PredictionInputError, match="obligatorios"):
        inference.build_frame([{"edad": 42}], _bundle())


def test_build_frame_rejects_non_numeric_values():
    with pytest.raises(inference.PredictionInputError, match="debe ser numérico"):
        inference.build_frame(
            [{"edad": "cuarenta", "ingreso": 3500, "ciudad": "Lima"}], _bundle()
        )


def test_build_frame_warns_on_unseen_category():
    _, warnings = inference.build_frame(
        [{"edad": 42, "ingreso": 3500, "ciudad": "Trujillo"}], _bundle()
    )
    assert any("Trujillo" in warning for warning in warnings)


def test_build_frame_imputes_optional_categorical():
    bundle = _bundle()
    bundle["input_schema"][2]["nullable"] = True
    frame, _ = inference.build_frame(
        [{"edad": 42, "ingreso": 3500}], bundle
    )
    assert frame.loc[0, "ciudad"] == "missing"


def test_binary_prediction_uses_tuned_threshold(monkeypatch):
    loaded = _loaded([[0.9], [0.2]])
    monkeypatch.setattr(inference._model_cache, "get", lambda key, **_: loaded)

    result = inference.predict(
        storage_key="models/p/j/model.keras",
        records=[
            {"edad": 42, "ingreso": 3500, "ciudad": "Lima"},
            {"edad": 25, "ingreso": 1500, "ciudad": "Cusco"},
        ],
        metrics_summary={"decision_threshold": 0.6},
    )

    assert result["task"] == "classification"
    assert result["decision_threshold"] == pytest.approx(0.6)
    assert result["predictions"][0]["prediction"] == "1"
    assert result["predictions"][0]["probability"] == pytest.approx(0.9)
    assert result["predictions"][1]["prediction"] == "0"


def test_explicit_threshold_overrides_metrics(monkeypatch):
    loaded = _loaded([[0.55]])
    monkeypatch.setattr(inference._model_cache, "get", lambda key, **_: loaded)

    result = inference.predict(
        storage_key="models/p/j/model.keras",
        records=[{"edad": 42, "ingreso": 3500, "ciudad": "Lima"}],
        threshold=0.5,
        metrics_summary={"decision_threshold": 0.99},
    )

    assert result["predictions"][0]["prediction"] == "1"
    assert result["predictions"][0]["threshold"] == pytest.approx(0.5)


def test_multiclass_prediction_returns_all_probabilities(monkeypatch):
    loaded = _loaded(
        [[0.1, 0.7, 0.2]],
        bundle=_bundle(task="classification", class_labels=["bajo", "medio", "alto"], output_units=3),
    )
    monkeypatch.setattr(inference._model_cache, "get", lambda key, **_: loaded)

    result = inference.predict(
        storage_key="models/p/j/model.keras",
        records=[{"edad": 42, "ingreso": 3500, "ciudad": "Lima"}],
    )

    item = result["predictions"][0]
    assert item["prediction"] == "medio"
    assert item["probabilities"] == pytest.approx({"bajo": 0.1, "medio": 0.7, "alto": 0.2})


def test_regression_prediction_returns_value(monkeypatch):
    bundle = _bundle(task="regression", class_labels=[], output_units=1)
    bundle["target_column"] = "precio"
    loaded = _loaded([[123.456]], bundle=bundle)
    monkeypatch.setattr(inference._model_cache, "get", lambda key, **_: loaded)

    result = inference.predict(
        storage_key="models/p/j/model.keras",
        records=[{"edad": 42, "ingreso": 3500, "ciudad": "Lima"}],
    )

    assert result["task"] == "regression"
    assert result["predictions"][0]["prediction"] == pytest.approx(123.456)


def test_regression_rejects_threshold(monkeypatch):
    bundle = _bundle(task="regression", class_labels=[], output_units=1)
    loaded = _loaded([[1.0]], bundle=bundle)
    monkeypatch.setattr(inference._model_cache, "get", lambda key, **_: loaded)

    with pytest.raises(inference.PredictionInputError, match="solo aplica"):
        inference.predict(
            storage_key="models/p/j/model.keras",
            records=[{"edad": 42, "ingreso": 3500, "ciudad": "Lima"}],
            threshold=0.3,
        )


def test_predict_forwards_checksums_with_artifact_filenames(monkeypatch):
    """Los hashes registrados por el worker usan claves lógicas.

    La verificación de integridad debe recibirlos con el nombre real del
    archivo; de lo contrario nunca se comparan.
    """
    loaded = _loaded([[0.9]])
    captured: dict = {}

    def fake_get(storage_key, expected_checksums=None):
        captured["storage_key"] = storage_key
        captured["expected_checksums"] = expected_checksums
        return loaded

    monkeypatch.setattr(inference._model_cache, "get", fake_get)

    inference.predict(
        storage_key="models/p/j/model.keras",
        records=[{"edad": 42, "ingreso": 3500, "ciudad": "Lima"}],
        metrics_summary={
            "artifacts": {
                "model": {"path": "model.keras", "sha256": "a" * 64},
                "scaler": {"path": "scaler.pkl", "sha256": "b" * 64},
                "preprocessor": {"path": "preprocessor.pkl", "sha256": "c" * 64},
                "manifest": {"path": "training_manifest.json", "sha256": "d" * 64},
            }
        },
    )

    assert captured["expected_checksums"] == {
        "model.keras": "a" * 64,
        "scaler.pkl": "b" * 64,
        "preprocessor.pkl": "c" * 64,
        "training_manifest.json": "d" * 64,
    }


def test_verify_artifact_detects_tampering():
    content = b"contenido del artefacto"

    inference._verify_artifact(
        "model.keras", content, {"model.keras": hashlib.sha256(content).hexdigest()}
    )

    with pytest.raises(inference.InferenceError, match="Integridad violada"):
        inference._verify_artifact("model.keras", content, {"model.keras": "0" * 64})


def test_verify_artifact_skips_when_no_checksum_registered():
    inference._verify_artifact("model.keras", b"contenido", {})
    inference._verify_artifact("model.keras", b"contenido", None)


def test_model_cache_reloads_when_checksum_changes(monkeypatch):
    loads: list = []

    def fake_load(storage_key, expected_checksums=None):
        loads.append(expected_checksums)
        return _loaded([[0.5]])

    monkeypatch.setattr(inference, "_load_model", fake_load)

    inference._model_cache.get("models/p/j/model.keras", {"model.keras": "a" * 64})
    inference._model_cache.get("models/p/j/model.keras", {"model.keras": "a" * 64})
    inference._model_cache.get("models/p/j/model.keras", {"model.keras": "b" * 64})

    assert [entry["model.keras"] for entry in loads] == ["a" * 64, "b" * 64]


# ---------------------------------------------------------------------------
# Contrato HTTP
# ---------------------------------------------------------------------------
async def _project(client: AsyncClient, headers: dict, name: str = "Proyecto inferencia") -> str:
    response = await client.post(
        "/api/v1/projects", headers=headers, json={"name": name, "description": "Inferencia"}
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _insert_model(
    project_id: str,
    *,
    storage_key: str = "models/p/j/model.keras",
    status: str = "DRAFT",
    metrics_summary: dict | None = None,
) -> str:
    async with AsyncSessionLocal() as db:
        model = ModelVersionModel(
            project_id=UUID(project_id),
            job_id=uuid4(),
            version="v1.0",
            storage_key=storage_key,
            status=status,
            checksum="b" * 64,
            metrics_summary=metrics_summary
            if metrics_summary is not None
            else {"task": "classification", "class_labels": ["0", "1"], "decision_threshold": 0.5},
        )
        db.add(model)
        await db.commit()
        await db.refresh(model)
        return str(model.id)


def _write_artifact(model_storage_key: str, filename: str, content: bytes) -> None:
    path = Path(settings.MODEL_DIR) / model_storage_key
    target = path.parent / filename
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)


def _predict_payload() -> dict:
    return {"records": [{"edad": 42, "ingreso": 3500, "ciudad": "Lima"}]}


async def test_predict_endpoint_returns_predictions(
    client: AsyncClient, admin_headers: dict, monkeypatch
):
    project_id = await _project(client, admin_headers)
    model_id = await _insert_model(project_id)

    def fake_predict(*, storage_key, records, threshold, metrics_summary):
        return {
            "task": "classification",
            "target_column": "abandono",
            "class_labels": ["0", "1"],
            "decision_threshold": 0.5,
            "predictions": [
                {
                    "index": 0,
                    "prediction": "1",
                    "label": "1",
                    "probability": 0.88,
                    "probabilities": {"0": 0.12, "1": 0.88},
                    "threshold": 0.5,
                }
            ],
            "warnings": [],
        }

    monkeypatch.setattr(inference, "predict", fake_predict)

    response = await client.post(
        f"/api/v1/models/{model_id}/predict", headers=admin_headers, json=_predict_payload()
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["model_version"] == "v1.0"
    assert body["task"] == "classification"
    assert body["predictions"][0]["prediction"] == "1"

    audit = await client.get(
        f"/api/v1/projects/{project_id}/audit-events", headers=admin_headers
    )
    assert "MODEL_PREDICTED" in [event["action"] for event in audit.json()]


async def test_predict_returns_503_without_optional_dependencies(
    client: AsyncClient, admin_headers: dict, monkeypatch
):
    project_id = await _project(client, admin_headers)
    model_id = await _insert_model(project_id, storage_key=f"models/{project_id}/job/model.keras")

    monkeypatch.setattr(inference, "missing_dependencies", lambda: ["tensorflow", "sklearn"])

    response = await client.post(
        f"/api/v1/models/{model_id}/predict", headers=admin_headers, json=_predict_payload()
    )
    assert response.status_code == 503, response.text
    assert "tensorflow" in response.json()["detail"]


async def test_predict_rejects_threshold_for_multiclass(
    client: AsyncClient, admin_headers: dict
):
    project_id = await _project(client, admin_headers)
    model_id = await _insert_model(
        project_id,
        metrics_summary={"task": "classification", "class_labels": ["a", "b", "c"]},
    )

    response = await client.post(
        f"/api/v1/models/{model_id}/predict",
        headers=admin_headers,
        json={**_predict_payload(), "threshold": 0.4},
    )
    assert response.status_code == 422


async def test_predict_rejects_retired_model(client: AsyncClient, admin_headers: dict):
    project_id = await _project(client, admin_headers)
    model_id = await _insert_model(project_id, status="RETIRED")

    response = await client.post(
        f"/api/v1/models/{model_id}/predict", headers=admin_headers, json=_predict_payload()
    )
    assert response.status_code == 409


async def test_predict_rejects_unknown_model(client: AsyncClient, admin_headers: dict):
    response = await client.post(
        f"/api/v1/models/{uuid4()}/predict", headers=admin_headers, json=_predict_payload()
    )
    assert response.status_code == 404


async def test_model_card_and_manifest_endpoints(
    client: AsyncClient, admin_headers: dict
):
    project_id = await _project(client, admin_headers, "Proyecto ficha")
    storage_key = f"models/{project_id}/job/model.keras"
    model_id = await _insert_model(project_id, storage_key=storage_key)

    _write_artifact(storage_key, "model_card.md", "# Ficha del modelo\n\nAccuracy: 0.9\n".encode())
    _write_artifact(
        storage_key,
        "training_manifest.json",
        json.dumps({"schema_version": 2, "job_id": "abc"}).encode(),
    )

    card = await client.get(f"/api/v1/models/{model_id}/card", headers=admin_headers)
    assert card.status_code == 200, card.text
    assert card.headers["content-type"].startswith("text/markdown")
    assert "Ficha del modelo" in card.text

    manifest = await client.get(f"/api/v1/models/{model_id}/manifest", headers=admin_headers)
    assert manifest.status_code == 200, manifest.text
    assert manifest.json()["schema_version"] == 2


async def test_model_card_missing_returns_404(client: AsyncClient, admin_headers: dict):
    project_id = await _project(client, admin_headers, "Proyecto sin ficha")
    model_id = await _insert_model(
        project_id, storage_key=f"models/{project_id}/job-inexistente/model.keras"
    )

    card = await client.get(f"/api/v1/models/{model_id}/card", headers=admin_headers)
    assert card.status_code == 404
