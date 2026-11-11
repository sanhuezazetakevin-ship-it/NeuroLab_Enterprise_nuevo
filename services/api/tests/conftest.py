"""Fixtures de integración para la API NeuroLab.

Se usa SQLite asíncrono en un directorio temporal para que las pruebas sean
repetibles y no dependan de PostgreSQL/Redis. El backend de cola se fuerza a
``filesystem`` para verificar el contrato con el worker sin infraestructura.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

TEST_ROOT = Path(tempfile.mkdtemp(prefix="neurolab_api_tests_"))
os.environ["ENVIRONMENT"] = "test"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{(TEST_ROOT / 'test.db').as_posix()}"
os.environ["DATA_DIR"] = str(TEST_ROOT / "uploads")
os.environ["MODEL_DIR"] = str(TEST_ROOT / "models")
os.environ["QUEUE_BACKEND"] = "filesystem"
os.environ["SECRET_KEY"] = "test_secret_key_for_neurolab_integration_suite_123456"
os.environ["LOGIN_RATE_LIMIT_PER_MINUTE"] = "10000"
os.environ["SEED_ADMIN_EMAIL"] = "admin@neurolab.enterprise"
os.environ["SEED_ADMIN_PASSWORD"] = "Admin123!"

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.core.bootstrap import ensure_seed_admin
from app.core.config import settings
from app.core.database import Base, engine
from app.main import app
from app.repositories import models  # noqa: F401  (registra metadatos)


@pytest_asyncio.fixture(autouse=True)
async def reset_state():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    for directory in (
        TEST_ROOT / "uploads" / "queue",
        TEST_ROOT / "uploads" / "cancellations",
        TEST_ROOT / "uploads" / "events",
        TEST_ROOT / "models",
    ):
        if directory.exists():
            shutil.rmtree(directory, ignore_errors=True)
        directory.mkdir(parents=True, exist_ok=True)
    await ensure_seed_admin()
    yield


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as async_client:
        yield async_client


@pytest_asyncio.fixture
async def admin_headers(client: AsyncClient) -> dict:
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": settings.SEED_ADMIN_EMAIL, "password": settings.SEED_ADMIN_PASSWORD},
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def _create_user(client: AsyncClient, admin_headers: dict, email: str, role: str = "AI_ENGINEER") -> dict:
    response = await client.post(
        "/api/v1/admin/users",
        headers=admin_headers,
        json={
            "email": email,
            "password": "User123!",
            "display_name": email.split("@")[0],
            "role": role,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _login(client: AsyncClient, email: str, password: str = "User123!") -> dict:
    response = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture
def create_user(client):
    async def factory(admin_headers: dict, email: str, role: str = "AI_ENGINEER") -> dict:
        return await _create_user(client, admin_headers, email, role)

    return factory


@pytest.fixture
def login(client):
    async def factory(email: str, password: str = "User123!") -> dict:
        return await _login(client, email, password)

    return factory


@pytest.fixture
def dataset_csv() -> bytes:
    header = "edad,ingreso,visitas,abandono\n"
    rows = []
    for index in range(40):
        age = 20 + index
        income = 30000 + (index * 750)
        visits = index % 12
        target = 1 if (visits < 5 and income < 50000) else 0
        rows.append(f"{age},{income},{visits},{target}\n")
    return (header + "".join(rows)).encode("utf-8")


@pytest.fixture
def invalid_csv() -> bytes:
    return b",b\n1,2\n"
