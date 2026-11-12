"""Pruebas del lease de trabajos del worker (recuperación de huérfanos).

Se usa una base SQLite temporal para verificar que un worker que arranca no
falla entrenamientos vivos de otras réplicas.
"""

from __future__ import annotations

import os
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

_DB_PATH = Path(tempfile.mkdtemp(prefix="neurolab_worker_db_")) / "worker.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_DB_PATH.as_posix()}"

from sqlalchemy import create_engine  # noqa: E402

import worker_db as db  # noqa: E402

# Cinturón y tirantes: aunque worker_config se hubiera importado antes, las
# pruebas usan siempre esta base temporal y nunca la configurada en .env.
db.engine = create_engine(
    f"sqlite:///{_DB_PATH.as_posix()}",
    future=True,
    connect_args={"check_same_thread": False},
)


@pytest.fixture(autouse=True)
def _schema():
    db.metadata.drop_all(db.engine)
    db.metadata.create_all(db.engine)
    yield


def _insert_job(*, status: str, heartbeat_at, worker_id: str = "worker-1") -> uuid.UUID:
    job_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    with db.connection() as conn:
        conn.execute(
            db.training_jobs.insert().values(
                id=job_id,
                project_id=uuid.uuid4(),
                architecture_id=uuid.uuid4(),
                dataset_id=uuid.uuid4(),
                status=status,
                progress=0.0,
                hyperparameters={},
                cancel_requested=False,
                requested_by=None,
                started_at=now,
                ended_at=None,
                error_message=None,
                worker_id=worker_id,
                heartbeat_at=heartbeat_at,
                created_at=now,
            )
        )
    return job_id


def _status(job_id: uuid.UUID) -> str:
    job = db.get_job(job_id)
    assert job is not None
    return job["status"]


def test_recover_orphaned_jobs_only_fails_stale_leases():
    now = datetime.now(timezone.utc)
    fresh = _insert_job(status="RUNNING", heartbeat_at=now)
    stale = _insert_job(status="RUNNING", heartbeat_at=now - timedelta(hours=1))
    legacy = _insert_job(status="PREPARING", heartbeat_at=None)
    finished = _insert_job(status="COMPLETED", heartbeat_at=now - timedelta(days=1))

    recovered = db.recover_orphaned_jobs(stale_after_seconds=900)

    assert recovered == 2
    assert _status(fresh) == "RUNNING"
    assert _status(stale) == "FAILED"
    assert _status(legacy) == "FAILED"
    assert _status(finished) == "COMPLETED"


def test_touch_job_renews_only_its_own_lease():
    old = datetime.now(timezone.utc) - timedelta(minutes=5)
    job = _insert_job(status="RUNNING", heartbeat_at=old, worker_id="worker-1")

    # Otro worker no puede renovar el lease ajeno.
    db.touch_job(job, "worker-2")
    assert db.recover_orphaned_jobs(stale_after_seconds=60) == 1

    job = _insert_job(status="RUNNING", heartbeat_at=old, worker_id="worker-1")
    db.touch_job(job, "worker-1")
    assert db.recover_orphaned_jobs(stale_after_seconds=60) == 0


def test_claim_job_does_not_override_cancelled_or_completed():
    now = datetime.now(timezone.utc)
    queued = _insert_job(status="QUEUED", heartbeat_at=None)
    cancelled = _insert_job(status="CANCELLED", heartbeat_at=None)
    completed = _insert_job(status="COMPLETED", heartbeat_at=now)

    assert db.claim_job(queued, worker_id="worker-1", heartbeat_at=now) is True
    assert db.claim_job(cancelled, worker_id="worker-1", heartbeat_at=now) is False
    assert db.claim_job(completed, worker_id="worker-1", heartbeat_at=now) is False

    assert _status(queued) == "PREPARING"
    assert _status(cancelled) == "CANCELLED"
    assert _status(completed) == "COMPLETED"
