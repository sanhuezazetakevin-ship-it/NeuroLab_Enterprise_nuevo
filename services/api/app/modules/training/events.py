import asyncio
import json
import logging
from typing import AsyncGenerator, Dict, List, Optional
from uuid import UUID

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.modules.training.queue import redis_client
from app.repositories.models import TrainingJobModel, TrainingMetricModel

logger = logging.getLogger(__name__)

TERMINAL_STATES = {"COMPLETED", "FAILED", "CANCELLED"}
CHANNEL_PREFIX = "neurolab:job"


def metric_rows_to_history(rows: List[TrainingMetricModel]) -> List[dict]:
    epochs: Dict[int, dict] = {}
    for row in rows:
        bucket = epochs.setdefault(row.epoch, {"epoch": row.epoch})
        bucket[row.metric_name] = row.metric_value
    return [epochs[key] for key in sorted(epochs)]


async def job_snapshot(job_id: UUID) -> Optional[dict]:
    async with AsyncSessionLocal() as db:
        job = await db.get(TrainingJobModel, job_id)
        if not job:
            return None
        rows = (
            await db.scalars(
                select(TrainingMetricModel)
                .where(TrainingMetricModel.job_id == job_id)
                .order_by(TrainingMetricModel.epoch, TrainingMetricModel.metric_name)
            )
        ).all()
        return {
            "id": str(job.id),
            "project_id": str(job.project_id),
            "status": job.status,
            "progress": job.progress,
            "cancel_requested": job.cancel_requested,
            "error_message": job.error_message,
            "started_at": job.started_at.isoformat() if job.started_at else None,
            "ended_at": job.ended_at.isoformat() if job.ended_at else None,
            "metrics_history": metric_rows_to_history(list(rows)),
        }


async def stream_job_events(
    job_id: UUID, poll_interval: float = 1.5
) -> AsyncGenerator[dict, None]:
    """Emite snapshot, estados y métricas de un trabajo.

    Canal primario: Redis Pub/Sub publicado por el worker. Respaldo y
    recuperación: consulta periódica a PostgreSQL (fuente de verdad), de modo
    que una reconexión no pierde épocas ni estados.
    """
    snapshot = await job_snapshot(job_id)
    if snapshot is None:
        yield {"event": "error", "detail": "Trabajo no encontrado"}
        return

    yield {"event": "snapshot", "job": snapshot}
    last_status = snapshot["status"]
    last_epoch = max((m["epoch"] for m in snapshot["metrics_history"]), default=0)

    client = await redis_client()
    pubsub = None
    if client is not None:
        pubsub = client.pubsub()
        await pubsub.subscribe(f"{CHANNEL_PREFIX}:{job_id}:events")

    try:
        while True:
            emitted = False

            if pubsub is not None:
                try:
                    message = await asyncio.wait_for(
                        pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0),
                        timeout=1.5,
                    )
                    if message and message.get("data"):
                        payload = json.loads(message["data"])
                        if payload.get("event") == "epoch_end":
                            last_epoch = max(last_epoch, int(payload.get("epoch", 0)))
                        elif payload.get("event") == "state":
                            last_status = payload.get("status", last_status)
                        yield payload
                        emitted = True
                except asyncio.TimeoutError:
                    pass
                except Exception:
                    await pubsub.close()
                    pubsub = None

            if not emitted:
                await asyncio.sleep(poll_interval)

            current = await job_snapshot(job_id)
            if current is None:
                yield {"event": "error", "detail": "Trabajo no encontrado"}
                return

            new_epochs = [m for m in current["metrics_history"] if m["epoch"] > last_epoch]
            if new_epochs:
                last_epoch = max(m["epoch"] for m in new_epochs)
                yield {
                    "event": "metrics",
                    "job_id": str(job_id),
                    "status": current["status"],
                    "progress": current["progress"],
                    "metrics": new_epochs,
                }

            if current["status"] != last_status:
                last_status = current["status"]
                yield {
                    "event": "state",
                    "job_id": str(job_id),
                    "status": current["status"],
                    "progress": current["progress"],
                    "error_message": current["error_message"],
                    "metrics_history": current["metrics_history"],
                }

            if last_status in TERMINAL_STATES:
                # Una última lectura asegura que no se perdió la métrica final.
                final = await job_snapshot(job_id)
                if final and final["status"] == last_status:
                    yield {
                        "event": "state",
                        "job_id": str(job_id),
                        "status": final["status"],
                        "progress": final["progress"],
                        "error_message": final["error_message"],
                        "metrics_history": final["metrics_history"],
                    }
                return
    finally:
        if pubsub is not None:
            try:
                await pubsub.unsubscribe(f"{CHANNEL_PREFIX}:{job_id}:events")
                await pubsub.close()
            except Exception:
                logger.debug("Error al cerrar la suscripción pub/sub", exc_info=True)
        if client is not None:
            await client.aclose()


def format_sse(payload: dict) -> str:
    return f"event: {payload.get('event', 'message')}\ndata: {json.dumps(payload, default=str)}\n\n"
