"""Genera datos de demostración de NeuroLab sobre una base SQLite aislada.

Uso:
    1. Arrancar la API apuntando a la base de demo (ver docs/DEMO_EXPOSICION.md).
    2. python scripts/seed_demo.py

Crea un proyecto, carga el CSV de ejemplo, entrena un modelo real con el
worker de TensorFlow, lo deja aprobado, crea un usuario REVIEWER y deja un
segundo trabajo en cola para entrenar en vivo durante la exposición.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import httpx

REPO = Path(__file__).resolve().parents[1]
DEMO = Path(os.getenv("NEUROLAB_DEMO_DIR", str(Path(os.getenv("TEMP", ".")) / "neurolab_demo")))
CSV = REPO / "data_prueba_clientes.csv"
BASE = os.getenv("NEUROLAB_DEMO_API", "http://127.0.0.1:8000/api/v1")
API_ORIGIN = BASE.split("/api/")[0]
ADMIN_EMAIL = os.getenv("SEED_ADMIN_EMAIL", "admin@neurolab.enterprise")
ADMIN_PASSWORD = os.getenv("SEED_ADMIN_PASSWORD", "Admin123!")


def demo_env() -> dict:
    env = os.environ.copy()
    env.update(
        {
            "ENVIRONMENT": "development",
            "DATABASE_URL": f"sqlite+aiosqlite:///{(DEMO / 'demo.db').as_posix()}",
            "DATA_DIR": str(DEMO / "uploads"),
            "MODEL_DIR": str(DEMO / "models"),
            "TEMP_DIR": str(DEMO / "tmp"),
            "QUEUE_BACKEND": "filesystem",
            "STORAGE_BACKEND": "local",
            "SECRET_KEY": "demo_secret_key_neurolab_1234567890abcdef",
            "WORKER_ID": "demo-worker-1",
            "WORKER_HEARTBEAT_TIMEOUT_SECONDS": "900",
            "TF_CPP_MIN_LOG_LEVEL": "2",
            "PYTHONUNBUFFERED": "1",
        }
    )
    for key in ("S3_ENDPOINT_URL", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"):
        env[key] = ""
    return env


def wait_api(client: httpx.Client, timeout: float = 120.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if client.get(f"{API_ORIGIN}/health").status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(1)
    raise RuntimeError("La API demo no respondió a tiempo")


def main() -> int:
    DEMO.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=120.0) as client:
        wait_api(client)
        login = client.post(
            f"{BASE}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
        )
        login.raise_for_status()
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        project = client.post(
            f"{BASE}/projects",
            headers=headers,
            json={
                "name": "Predicción de Abandono de Clientes",
                "description": "Caso de estudio del instituto: detectar clientes en riesgo de abandono.",
                "network_family": "FEEDFORWARD",
            },
        )
        project.raise_for_status()
        project_id = project.json()["id"]
        print(f"proyecto={project_id}")

        with open(CSV, "rb") as handle:
            dataset = client.post(
                f"{BASE}/projects/{project_id}/datasets/upload",
                headers=headers,
                files={"file": (CSV.name, handle, "text/csv")},
                data={"name": "Clientes del instituto", "target_column": "abandono"},
            )
        dataset.raise_for_status()
        dataset_json = dataset.json()
        dataset_id = dataset_json["id"]
        input_neurons = int(dataset_json["metadata_json"]["neurons"]["input_neurons"])
        print(f"dataset={dataset_id} input_neurons={input_neurons}")

        architecture = client.post(
            f"{BASE}/projects/{project_id}/architectures",
            headers=headers,
            json={
                "name": "MLP de referencia",
                "family": "FEEDFORWARD",
                "config_json": {
                    "input_shape": [input_neurons],
                    "layers": [
                        {"type": "Dense", "units": 32, "activation": "relu"},
                        {"type": "Dropout", "rate": 0.15},
                        {"type": "Dense", "units": 16, "activation": "relu"},
                        {"type": "Dense", "units": 1, "activation": "sigmoid"},
                    ],
                },
            },
        )
        architecture.raise_for_status()
        architecture_id = architecture.json()["id"]

        job = client.post(
            f"{BASE}/projects/{project_id}/training-jobs",
            headers=headers,
            json={
                "architecture_id": architecture_id,
                "dataset_id": dataset_id,
                "target_column": "abandono",
                "hyperparameters": {
                    "epochs": 15,
                    "batch_size": 32,
                    "optimizer": "adam",
                    "learning_rate": 0.001,
                    "metrics": ["accuracy"],
                    "random_seed": 42,
                    "validation_split": 0.15,
                    "early_stopping": False,
                },
            },
        )
        job.raise_for_status()
        job_id = job.json()["id"]
        print(f"job1={job_id}")

        worker = subprocess.run(
            [sys.executable, str(REPO / "workers" / "training" / "worker.py"), "--once"],
            cwd=str(REPO),
            env=demo_env(),
            capture_output=True,
            text=True,
            timeout=900,
        )
        print(f"worker1 exit={worker.returncode}")
        if worker.returncode != 0:
            print(worker.stdout[-4000:])
            print(worker.stderr[-4000:])
            return 1

        deadline = time.time() + 60
        status = None
        while time.time() < deadline:
            status = client.get(f"{BASE}/training-jobs/{job_id}", headers=headers).json()["status"]
            if status in {"COMPLETED", "FAILED", "CANCELLED"}:
                break
            time.sleep(1)
        print(f"job1 status={status}")
        if status != "COMPLETED":
            return 1

        models = client.get(f"{BASE}/projects/{project_id}/models", headers=headers).json()
        model_id = models[0]["id"]
        for target in ("REVIEWED", "APPROVED"):
            response = client.patch(
                f"{BASE}/models/{model_id}/status",
                headers=headers,
                json={"status": target, "reason": f"Transición de demostración a {target}"},
            )
            response.raise_for_status()
        print(f"model={model_id} aprobado")

        reviewer = client.post(
            f"{BASE}/admin/users",
            headers=headers,
            json={
                "email": "revisor@instituto.edu",
                "password": "Revisor123!",
                "display_name": "Dra. Revisora de Modelos",
                "role": "REVIEWER",
            },
        )
        if reviewer.status_code not in (201, 409):
            print(f"reviewer HTTP {reviewer.status_code}: {reviewer.text[:300]}")
        member = client.post(
            f"{BASE}/projects/{project_id}/members",
            headers=headers,
            json={"email": "revisor@instituto.edu", "role": "REVIEWER"},
        )
        print(f"reviewer miembro HTTP {member.status_code}")

        # Segundo trabajo en cola para ejecutar en vivo frente a la audiencia.
        deep = client.post(
            f"{BASE}/projects/{project_id}/architectures",
            headers=headers,
            json={
                "name": "MLP profunda (entrenamiento en vivo)",
                "family": "FEEDFORWARD",
                "config_json": {
                    "input_shape": [input_neurons],
                    "layers": [
                        {"type": "Dense", "units": 64, "activation": "relu"},
                        {"type": "Dropout", "rate": 0.2},
                        {"type": "Dense", "units": 32, "activation": "relu"},
                        {"type": "Dense", "units": 16, "activation": "relu"},
                        {"type": "Dense", "units": 1, "activation": "sigmoid"},
                    ],
                },
            },
        )
        deep.raise_for_status()
        deep_id = deep.json()["id"]
        # Con un worker persistente precalentado no se encola el trabajo de 60
        # épocas: el entrenamiento en vivo se lanza desde la UI y arranca en
        # segundos. SEED_LIVE_JOB=0 permite ese modo.
        enqueue_live_job = os.getenv("SEED_LIVE_JOB", "1").strip().lower() not in {
            "0",
            "false",
            "no",
        }
        live_job_id = None
        if enqueue_live_job:
            live_job = client.post(
                f"{BASE}/projects/{project_id}/training-jobs",
                headers=headers,
                json={
                    "architecture_id": deep_id,
                    "dataset_id": dataset_id,
                    "target_column": "abandono",
                    "hyperparameters": {
                        "epochs": 60,
                        "batch_size": 8,
                        "optimizer": "adam",
                        "learning_rate": 0.001,
                        "metrics": ["accuracy"],
                        "random_seed": 7,
                        "validation_split": 0.15,
                        "early_stopping": False,
                    },
                },
            )
            live_job.raise_for_status()
            live_job_id = live_job.json()["id"]

        preview = client.get(
            f"{BASE}/projects/{project_id}/datasets/{dataset_id}/preview", headers=headers
        ).json()
        feature_names = [
            c["name"] for c in dataset_json["metadata_json"]["columns"] if c["name"] != "abandono"
        ]
        sample_rows = [
            {name: row.get(name) for name in feature_names} for row in preview["rows"][:3]
        ]

        summary = {
            "project_id": project_id,
            "dataset_id": dataset_id,
            "architecture_id": architecture_id,
            "model_id": model_id,
            "live_job_id": live_job_id,
            "input_neurons": input_neurons,
            "sample_rows": sample_rows,
        }
        (DEMO / "demo_ids.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
        print(json.dumps(summary, indent=2))
        print("SEED_OK")
        return 0


if __name__ == "__main__":
    sys.exit(main())
