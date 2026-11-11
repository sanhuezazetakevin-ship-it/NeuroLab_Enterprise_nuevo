from uuid import UUID

from httpx import AsyncClient

from app.core.database import AsyncSessionLocal
from app.repositories.models import ModelVersionModel


async def _project(client: AsyncClient, headers: dict, name: str = "Proyecto registro") -> str:
    response = await client.post(
        "/api/v1/projects", headers=headers, json={"name": name, "description": "Registro"}
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _completed_job(
    client: AsyncClient, headers: dict, project_id: str, csv_bytes: bytes
) -> dict:
    dataset = (
        await client.post(
            f"/api/v1/projects/{project_id}/datasets/upload",
            headers=headers,
            files={"file": ("clientes.csv", csv_bytes, "text/csv")},
            data={"name": "Clientes", "target_column": "abandono"},
        )
    ).json()
    architecture = (
        await client.post(
            f"/api/v1/projects/{project_id}/architectures",
            headers=headers,
            json={
                "name": "Red registro",
                "family": "FEEDFORWARD",
                "config_json": {
                    "input_shape": [3],
                    "layers": [
                        {"type": "Dense", "units": 8, "activation": "relu"},
                        {"type": "Dense", "units": 1, "activation": "sigmoid"},
                    ],
                },
            },
        )
    ).json()
    job = (
        await client.post(
            f"/api/v1/projects/{project_id}/training-jobs",
            headers=headers,
            json={
                "architecture_id": architecture["id"],
                "dataset_id": dataset["id"],
                "target_column": "abandono",
                "hyperparameters": {"epochs": 1, "batch_size": 8},
            },
        )
    ).json()
    return job


async def _insert_model(project_id: str, job_id: str, storage_key: str = "models/demo/model.keras") -> str:
    async with AsyncSessionLocal() as db:
        model = ModelVersionModel(
            project_id=UUID(project_id),
            job_id=UUID(job_id),
            version="v1.0",
            storage_key=storage_key,
            status="DRAFT",
            checksum="a" * 64,
            metrics_summary={"accuracy": 0.9, "loss": 0.2},
        )
        db.add(model)
        await db.commit()
        await db.refresh(model)
        return str(model.id)


async def test_model_lifecycle_transitions_and_governance(
    client: AsyncClient, admin_headers: dict, dataset_csv: bytes
):
    project_id = await _project(client, admin_headers)
    job = await _completed_job(client, admin_headers, project_id, dataset_csv)
    model_id = await _insert_model(project_id, job["id"])

    listing = await client.get(f"/api/v1/projects/{project_id}/models", headers=admin_headers)
    assert listing.status_code == 200
    assert len(listing.json()) == 1

    invalid = await client.patch(
        f"/api/v1/models/{model_id}/status",
        headers=admin_headers,
        json={"status": "APPROVED"},
    )
    assert invalid.status_code == 409

    reviewed = await client.patch(
        f"/api/v1/models/{model_id}/status",
        headers=admin_headers,
        json={"status": "REVIEWED", "reason": "Revisión técnica"},
    )
    assert reviewed.status_code == 200, reviewed.text
    assert reviewed.json()["status"] == "REVIEWED"

    approved = await client.patch(
        f"/api/v1/models/{model_id}/status",
        headers=admin_headers,
        json={"status": "APPROVED"},
    )
    assert approved.status_code == 200, approved.text

    retired = await client.patch(
        f"/api/v1/models/{model_id}/status",
        headers=admin_headers,
        json={"status": "RETIRED"},
    )
    assert retired.status_code == 200, retired.text
    assert retired.json()["status"] == "RETIRED"


async def test_model_download_requires_artifact(
    client: AsyncClient, admin_headers: dict, dataset_csv: bytes, tmp_path
):
    project_id = await _project(client, admin_headers, "Proyecto descarga")
    job = await _completed_job(client, admin_headers, project_id, dataset_csv)
    model_id = await _insert_model(project_id, job["id"], storage_key="models/demo/inexistente.keras")

    missing = await client.get(f"/api/v1/models/{model_id}/download", headers=admin_headers)
    assert missing.status_code == 404


async def test_audit_trail_records_actions(
    client: AsyncClient, admin_headers: dict
):
    project_id = await _project(client, admin_headers, "Proyecto auditoría")
    response = await client.get(
        f"/api/v1/projects/{project_id}/audit-events", headers=admin_headers
    )
    assert response.status_code == 200, response.text
    actions = [event["action"] for event in response.json()]
    assert "PROJECT_CREATED" in actions
