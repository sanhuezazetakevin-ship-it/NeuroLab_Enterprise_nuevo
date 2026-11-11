from pathlib import Path
from uuid import UUID

from httpx import AsyncClient

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.repositories.models import TrainingMetricModel


async def _project(client: AsyncClient, headers: dict) -> str:
    response = await client.post(
        "/api/v1/projects",
        headers=headers,
        json={"name": "Proyecto entrenamiento", "description": "Flujo MVP"},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _dataset(client: AsyncClient, headers: dict, project_id: str, csv_bytes: bytes) -> dict:
    response = await client.post(
        f"/api/v1/projects/{project_id}/datasets/upload",
        headers=headers,
        files={"file": ("clientes.csv", csv_bytes, "text/csv")},
        data={"name": "Clientes", "target_column": "abandono"},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _architecture(client: AsyncClient, headers: dict, project_id: str, family: str = "FEEDFORWARD") -> dict:
    if family == "FEEDFORWARD":
        config = {
            "input_shape": [3],
            "layers": [
                {"type": "Dense", "units": 8, "activation": "relu"},
                {"type": "Dropout", "rate": 0.1},
                {"type": "Dense", "units": 1, "activation": "sigmoid"},
            ],
        }
    elif family == "GAN":
        config = {
            "input_shape": [3],
            "layers": [
                {"type": "Dense", "units": 8, "activation": "relu"},
                {"type": "Dense", "units": 1, "activation": "sigmoid"},
            ],
        }
    else:
        config = {
            "input_shape": [3, 1],
            "layers": [
                {"type": "LSTM", "units": 4, "return_sequences": False},
                {"type": "Dense", "units": 1, "activation": "sigmoid"},
            ],
        }
    response = await client.post(
        f"/api/v1/projects/{project_id}/architectures",
        headers=headers,
        json={"name": f"Red {family}", "family": family, "config_json": config},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_architecture_validation_endpoint(client: AsyncClient, admin_headers: dict):
    project_id = await _project(client, admin_headers)
    payload = {
        "input_shape": [3],
        "layers": [
            {"type": "Dense", "units": 8, "activation": "relu"},
            {"type": "Dense", "units": 1, "activation": "sigmoid"},
        ],
    }
    response = await client.post(
        f"/api/v1/projects/{project_id}/architectures/validate?family=FEEDFORWARD",
        headers=admin_headers,
        json=payload,
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["valid"] is True
    assert result["trainable"] is True
    assert result["total_parameters"] > 0

    invalid = await client.post(
        f"/api/v1/projects/{project_id}/architectures/validate?family=FEEDFORWARD",
        headers=admin_headers,
        json={"input_shape": [3, 3], "layers": payload["layers"]},
    )
    assert invalid.status_code == 200
    assert invalid.json()["valid"] is False


async def test_architecture_is_saved_with_version(
    client: AsyncClient, admin_headers: dict
):
    project_id = await _project(client, admin_headers)
    first = await _architecture(client, admin_headers, project_id)
    second = await _architecture(client, admin_headers, project_id)
    assert first["version"] == 1
    assert second["version"] == 2

    listing = await client.get(
        f"/api/v1/projects/{project_id}/architectures", headers=admin_headers
    )
    assert listing.status_code == 200
    assert len(listing.json()) == 2


async def test_training_job_is_queued_and_cancel_is_persisted(
    client: AsyncClient, admin_headers: dict, dataset_csv: bytes
):
    project_id = await _project(client, admin_headers)
    dataset = await _dataset(client, admin_headers, project_id, dataset_csv)
    architecture = await _architecture(client, admin_headers, project_id)

    response = await client.post(
        f"/api/v1/projects/{project_id}/training-jobs",
        headers=admin_headers,
        json={
            "architecture_id": architecture["id"],
            "dataset_id": dataset["id"],
            "target_column": "abandono",
            "hyperparameters": {
                "epochs": 2,
                "batch_size": 8,
                "optimizer": "adam",
                "learning_rate": 0.01,
                "metrics": ["accuracy"],
                "random_seed": 42,
                "validation_split": 0.15,
            },
        },
    )
    assert response.status_code == 202, response.text
    job = response.json()
    assert job["status"] == "QUEUED"
    assert job["cancel_requested"] is False

    queue_files = list((Path(settings.DATA_DIR) / "queue").glob("*.json"))
    assert len(queue_files) == 1
    assert job["id"] in queue_files[0].name

    cancel = await client.post(
        f"/api/v1/training-jobs/{job['id']}/cancel", headers=admin_headers
    )
    assert cancel.status_code == 202, cancel.text
    assert cancel.json()["cancel_requested"] is True
    assert cancel.json()["status"] == "CANCELLED"
    # Un trabajo en cola se cancela de inmediato y se retira del descriptor.
    assert list((Path(settings.DATA_DIR) / "queue").glob("*.json")) == []

    fetched = await client.get(f"/api/v1/training-jobs/{job['id']}", headers=admin_headers)
    assert fetched.status_code == 200
    assert fetched.json()["cancel_requested"] is True
    assert fetched.json()["status"] == "CANCELLED"
    assert fetched.json()["ended_at"] is not None

    listing = await client.get(
        f"/api/v1/projects/{project_id}/training-jobs", headers=admin_headers
    )
    assert listing.status_code == 200
    assert len(listing.json()) == 1


async def test_rnn_training_job_is_accepted(
    client: AsyncClient, admin_headers: dict, dataset_csv: bytes
):
    project_id = await _project(client, admin_headers)
    dataset = await _dataset(client, admin_headers, project_id, dataset_csv)
    architecture = await _architecture(client, admin_headers, project_id, family="RNN")

    response = await client.post(
        f"/api/v1/projects/{project_id}/training-jobs",
        headers=admin_headers,
        json={
            "architecture_id": architecture["id"],
            "dataset_id": dataset["id"],
            "target_column": "abandono",
            "hyperparameters": {"epochs": 1, "batch_size": 8},
        },
    )
    assert response.status_code == 202, response.text
    assert response.json()["status"] == "QUEUED"


async def test_gan_training_is_rejected_with_reason(
    client: AsyncClient, admin_headers: dict, dataset_csv: bytes
):
    project_id = await _project(client, admin_headers)
    dataset = await _dataset(client, admin_headers, project_id, dataset_csv)
    architecture = await _architecture(client, admin_headers, project_id, family="GAN")

    response = await client.post(
        f"/api/v1/projects/{project_id}/training-jobs",
        headers=admin_headers,
        json={
            "architecture_id": architecture["id"],
            "dataset_id": dataset["id"],
            "target_column": "abandono",
            "hyperparameters": {"epochs": 1, "batch_size": 8},
        },
    )
    assert response.status_code == 422
    assert "GAN" in response.text


async def test_training_rejects_architecture_from_another_project(
    client: AsyncClient, admin_headers: dict, dataset_csv: bytes
):
    project_a = await _project(client, admin_headers)
    project_b = await _project(client, admin_headers)
    dataset_a = await _dataset(client, admin_headers, project_a, dataset_csv)
    architecture_b = await _architecture(client, admin_headers, project_b)

    response = await client.post(
        f"/api/v1/projects/{project_a}/training-jobs",
        headers=admin_headers,
        json={
            "architecture_id": architecture_b["id"],
            "dataset_id": dataset_a["id"],
            "target_column": "abandono",
            "hyperparameters": {"epochs": 1, "batch_size": 8},
        },
    )
    assert response.status_code == 422
    assert "no pertenece" in response.text


async def test_training_job_listing_groups_metrics_per_job(
    client: AsyncClient, admin_headers: dict, dataset_csv: bytes
):
    """Regresión del N+1: una sola consulta agrupada debe respetar cada job."""
    project_id = await _project(client, admin_headers)
    dataset = await _dataset(client, admin_headers, project_id, dataset_csv)
    architecture = await _architecture(client, admin_headers, project_id)

    job_ids = []
    for epochs in (1, 2):
        response = await client.post(
            f"/api/v1/projects/{project_id}/training-jobs",
            headers=admin_headers,
            json={
                "architecture_id": architecture["id"],
                "dataset_id": dataset["id"],
                "target_column": "abandono",
                "hyperparameters": {"epochs": epochs, "batch_size": 8},
            },
        )
        assert response.status_code == 202, response.text
        job_ids.append(response.json()["id"])

    async with AsyncSessionLocal() as db:
        for index, job_id in enumerate(job_ids):
            db.add(
                TrainingMetricModel(
                    job_id=UUID(job_id),
                    epoch=1,
                    metric_name="accuracy",
                    metric_value=0.5 + index / 10,
                )
            )
        await db.commit()

    listing = await client.get(
        f"/api/v1/projects/{project_id}/training-jobs", headers=admin_headers
    )
    assert listing.status_code == 200
    by_id = {job["id"]: job for job in listing.json()}
    assert by_id[job_ids[0]]["metrics"] == [{"epoch": 1, "accuracy": 0.5}]
    assert by_id[job_ids[1]]["metrics"] == [{"epoch": 1, "accuracy": 0.6}]

