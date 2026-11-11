"""Acceso a datos del worker (sincrónico).

El worker usa SQLAlchemy Core con un subconjunto de las tablas de la API. No
duplica reglas de negocio: sólo persiste el estado de ejecución, las métricas
por época, la auditoría y la versión inmutable del modelo.
"""

from __future__ import annotations

import json
import logging
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterator, List, Optional

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    Uuid,
    create_engine,
    func,
    insert,
    or_,
    select,
    update,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import Engine

from worker_config import DATABASE_URL

logger = logging.getLogger("neurolab.worker.db")

JSONType = JSON().with_variant(JSONB, "postgresql")

metadata = MetaData()

training_jobs = Table(
    "training_jobs",
    metadata,
    Column("id", Uuid(as_uuid=True), primary_key=True),
    Column("project_id", Uuid(as_uuid=True), nullable=False),
    Column("architecture_id", Uuid(as_uuid=True), nullable=False),
    Column("dataset_id", Uuid(as_uuid=True), nullable=False),
    Column("status", String(50), nullable=False),
    Column("progress", Float, nullable=False, default=0.0),
    Column("hyperparameters", JSONType, nullable=False, default=dict),
    Column("cancel_requested", Boolean, nullable=False, default=False),
    Column("requested_by", Uuid(as_uuid=True), nullable=True),
    Column("started_at", DateTime(timezone=True), nullable=True),
    Column("ended_at", DateTime(timezone=True), nullable=True),
    Column("error_message", Text, nullable=True),
    Column("worker_id", String(150), nullable=True),
    Column("heartbeat_at", DateTime(timezone=True), nullable=True),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Index("idx_training_jobs_project", "project_id"),
)

training_metrics = Table(
    "training_metrics",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("job_id", Uuid(as_uuid=True), ForeignKey("training_jobs.id"), nullable=False),
    Column("epoch", Integer, nullable=False),
    Column("metric_name", String(100), nullable=False),
    Column("metric_value", Float, nullable=False),
    Column("recorded_at", DateTime(timezone=True), nullable=False),
)

model_versions = Table(
    "model_versions",
    metadata,
    Column("id", Uuid(as_uuid=True), primary_key=True),
    Column("project_id", Uuid(as_uuid=True), nullable=False),
    Column("job_id", Uuid(as_uuid=True), nullable=False),
    Column("version", String(50), nullable=False),
    Column("storage_key", String(500), nullable=False),
    Column("status", String(50), nullable=False, default="DRAFT"),
    Column("checksum", String(128), nullable=False),
    Column("metrics_summary", JSONType, nullable=True),
    Column("created_at", DateTime(timezone=True), nullable=False),
)

architectures = Table(
    "architectures",
    metadata,
    Column("id", Uuid(as_uuid=True), primary_key=True),
    Column("project_id", Uuid(as_uuid=True), nullable=False),
    Column("name", String(200), nullable=False),
    Column("family", String(50), nullable=False),
    Column("config_json", JSONType, nullable=False),
    Column("version", Integer, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
)

datasets = Table(
    "datasets",
    metadata,
    Column("id", Uuid(as_uuid=True), primary_key=True),
    Column("project_id", Uuid(as_uuid=True), nullable=False),
    Column("name", String(200), nullable=False),
    Column("version", String(50), nullable=False),
    Column("storage_key", String(500), nullable=False),
    Column("original_filename", String(255), nullable=False),
    Column("size_bytes", Integer, nullable=False),
    Column("checksum", String(128), nullable=False),
    Column("target_column", String(150), nullable=True),
    Column("verified", Boolean, nullable=False),
    Column("metadata_json", JSONType, nullable=False),
    Column("created_by", Uuid(as_uuid=True), nullable=True),
    Column("created_at", DateTime(timezone=True), nullable=False),
)

audit_events = Table(
    "audit_events",
    metadata,
    Column("id", Uuid(as_uuid=True), primary_key=True),
    Column("actor_id", Uuid(as_uuid=True), nullable=True),
    Column("project_id", Uuid(as_uuid=True), nullable=True),
    Column("action", String(100), nullable=False),
    Column("metadata_json", JSONType, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _make_engine() -> Engine:
    kwargs: Dict[str, Any] = {"future": True, "pool_pre_ping": True}
    if DATABASE_URL.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False, "timeout": 30}
    else:
        kwargs.update({"pool_size": 5, "max_overflow": 10})
    engine = create_engine(DATABASE_URL, **kwargs)

    if DATABASE_URL.startswith("sqlite"):
        from sqlalchemy import event

        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(dbapi_connection, _record):  # pragma: no cover - depende del driver
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA busy_timeout=30000")
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return engine


engine = _make_engine()


@contextmanager
def connection() -> Iterator[Any]:
    with engine.begin() as conn:
        yield conn


def update_job(job_id: uuid.UUID, **fields: Any) -> None:
    if not fields:
        return
    with connection() as conn:
        conn.execute(update(training_jobs).where(training_jobs.c.id == job_id).values(**fields))


def set_job_status(
    job_id: uuid.UUID,
    status: str,
    *,
    progress: Optional[float] = None,
    error_message: Optional[str] = None,
    started_at: Optional[datetime] = None,
    ended_at: Optional[datetime] = None,
    worker_id: Optional[str] = None,
    heartbeat_at: Optional[datetime] = None,
) -> None:
    values: Dict[str, Any] = {"status": status}
    if progress is not None:
        values["progress"] = float(progress)
    if error_message is not None:
        values["error_message"] = error_message[:4000]
    if started_at is not None:
        values["started_at"] = started_at
    if ended_at is not None:
        values["ended_at"] = ended_at
    if worker_id is not None:
        values["worker_id"] = worker_id
    if heartbeat_at is not None:
        values["heartbeat_at"] = heartbeat_at
    update_job(job_id, **values)


def touch_job(job_id: uuid.UUID, worker_id: str) -> None:
    """Renueva el lease del trabajo solo si pertenece a este worker.

    Se llama al iniciar y en cada época para que otro worker pueda distinguir
    un trabajo vivo de uno abandonado tras una caída.
    """
    with connection() as conn:
        conn.execute(
            update(training_jobs)
            .where(
                training_jobs.c.id == job_id,
                training_jobs.c.worker_id == worker_id,
            )
            .values(heartbeat_at=utcnow())
        )


def get_job(job_id: uuid.UUID) -> Optional[Dict[str, Any]]:
    with connection() as conn:
        row = conn.execute(select(training_jobs).where(training_jobs.c.id == job_id)).mappings().first()
        return dict(row) if row else None


def get_job_bundle(job_id: uuid.UUID) -> Optional[Dict[str, Any]]:
    """Reconstruye el payload de un trabajo desde la base de datos.

    Se usa para ``--job-id`` y para recuperar trabajos que quedaron encolados
    tras un reinicio del worker.
    """
    with connection() as conn:
        job = conn.execute(select(training_jobs).where(training_jobs.c.id == job_id)).mappings().first()
        if not job:
            return None
        architecture = conn.execute(
            select(architectures).where(architectures.c.id == job["architecture_id"])
        ).mappings().first()
        dataset = conn.execute(
            select(datasets).where(datasets.c.id == job["dataset_id"])
        ).mappings().first()
        if not architecture or not dataset:
            return None

        hyperparameters = _as_dict(job["hyperparameters"])
        metadata_json = _as_dict(dataset["metadata_json"])
        return {
            "job_id": str(job["id"]),
            "project_id": str(job["project_id"]),
            "architecture_id": str(job["architecture_id"]),
            "dataset_id": str(job["dataset_id"]),
            "hyperparameters": hyperparameters,
            "architecture": {
                "id": str(architecture["id"]),
                "name": architecture["name"],
                "family": architecture["family"],
                "config_json": _as_dict(architecture["config_json"]),
                "version": architecture["version"],
            },
            "dataset": {
                "id": str(dataset["id"]),
                "name": dataset["name"],
                "version": dataset["version"],
                "original_filename": dataset["original_filename"],
                "storage_key": dataset["storage_key"],
                "checksum": dataset["checksum"],
                "size_bytes": dataset["size_bytes"],
                "target_column": dataset["target_column"],
                "metadata_json": metadata_json,
            },
            "target_column": hyperparameters.get("target_column") or metadata_json.get("target_column"),
            "task": hyperparameters.get("task") or metadata_json.get("task"),
        }


def _as_dict(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def clear_metrics(job_id: uuid.UUID) -> None:
    with connection() as conn:
        conn.execute(training_metrics.delete().where(training_metrics.c.job_id == job_id))


def insert_metrics(job_id: uuid.UUID, epoch: int, metrics: Dict[str, float]) -> None:
    if not metrics:
        return
    now = utcnow()
    rows = [
        {
            "job_id": job_id,
            "epoch": int(epoch),
            "metric_name": str(name)[:100],
            "metric_value": float(value),
            "recorded_at": now,
        }
        for name, value in metrics.items()
        if isinstance(value, (int, float)) and not isinstance(value, bool)
    ]
    if not rows:
        return
    with connection() as conn:
        conn.execute(insert(training_metrics), rows)


def metric_history(job_id: uuid.UUID) -> List[Dict[str, float]]:
    with connection() as conn:
        rows = conn.execute(
            select(training_metrics.c.epoch, training_metrics.c.metric_name, training_metrics.c.metric_value)
            .where(training_metrics.c.job_id == job_id)
            .order_by(training_metrics.c.epoch, training_metrics.c.metric_name)
        ).all()
    epochs: Dict[int, Dict[str, float]] = {}
    for epoch, name, value in rows:
        epochs.setdefault(int(epoch), {"epoch": int(epoch)})[name] = float(value)
    return [epochs[key] for key in sorted(epochs)]


def create_model_version(
    *,
    project_id: uuid.UUID,
    job_id: uuid.UUID,
    storage_key: str,
    checksum: str,
    metrics_summary: Dict[str, Any],
) -> Dict[str, Any]:
    with connection() as conn:
        for attempt in range(10):
            existing = conn.execute(
                select(func.count()).select_from(model_versions).where(model_versions.c.project_id == project_id)
            ).scalar_one()
            version = f"v1.{int(existing) + attempt}"
            model_id = uuid.uuid4()
            row = {
                "id": model_id,
                "project_id": project_id,
                "job_id": job_id,
                "version": version,
                "storage_key": storage_key,
                "status": "DRAFT",
                "checksum": checksum,
                "metrics_summary": metrics_summary,
                "created_at": utcnow(),
            }
            try:
                conn.execute(insert(model_versions).values(**row))
                return row
            except Exception as exc:
                if attempt == 9:
                    raise
                logger.warning("Reintentando creación de versión por colisión concurrente (%s): %s", version, exc)


def update_model_artifacts(
    *, model_id: uuid.UUID, artifacts: Dict[str, Any]
) -> None:
    """Completa el resumen del modelo con artefactos publicados después.

    La ficha y el manifiesto final se generan cuando ya existe la versión (el
    manifiesto incorpora ``model_version``), así que sus hashes deben
    registrarse al final para que coincidan exactamente con el disco.
    """
    with connection() as conn:
        current = conn.execute(
            select(model_versions.c.metrics_summary).where(
                model_versions.c.id == model_id
            )
        ).scalar_one()
        summary = dict(current or {})
        merged = dict(summary.get("artifacts") or {})
        merged.update(artifacts)
        summary["artifacts"] = merged
        card_path = (artifacts.get("model_card") or {}).get("path")
        if card_path:
            summary["model_card"] = card_path
        conn.execute(
            update(model_versions)
            .where(model_versions.c.id == model_id)
            .values(metrics_summary=summary)
        )


def record_audit(
    *,
    actor_id: Optional[uuid.UUID],
    project_id: Optional[uuid.UUID],
    action: str,
    metadata_payload: Optional[Dict[str, Any]] = None,
) -> None:
    with connection() as conn:
        conn.execute(
            insert(audit_events).values(
                id=uuid.uuid4(),
                actor_id=actor_id,
                project_id=project_id,
                action=action[:100],
                metadata_json=metadata_payload or {},
                created_at=utcnow(),
            )
        )


def cancel_requested(job_id: uuid.UUID) -> bool:
    job = get_job(job_id)
    return bool(job and job.get("cancel_requested"))


def recover_orphaned_jobs(*, stale_after_seconds: int = 900) -> int:
    """Falla trabajos en RUNNING/PREPARING cuyo lease haya caducado.

    Solo se consideran huérfanos los trabajos sin heartbeat reciente. Así un
    worker que arranca no interrumpe entrenamientos vivos de otras réplicas.
    """
    cutoff = utcnow() - timedelta(seconds=max(1, int(stale_after_seconds)))
    with connection() as conn:
        result = conn.execute(
            update(training_jobs)
            .where(
                training_jobs.c.status.in_(["RUNNING", "PREPARING"]),
                or_(
                    training_jobs.c.heartbeat_at.is_(None),
                    training_jobs.c.heartbeat_at < cutoff,
                ),
            )
            .values(
                status="FAILED",
                error_message="El proceso de entrenamiento se interrumpió inesperadamente (lease caducado)",
                ended_at=utcnow(),
            )
        )
        return int(result.rowcount or 0)
