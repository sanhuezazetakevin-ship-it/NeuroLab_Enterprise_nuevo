"""Publicación de telemetría del worker.

Los eventos se publican en Redis Pub/Sub (canal consumido por SSE/WebSocket) y
se anexan a un log JSONL local. La base de datos sigue siendo la fuente de
verdad: el log local permite auditar y el sondeo de la API recupera el estado
tras una reconexión aunque Redis no esté disponible.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, Optional
from uuid import UUID

from worker_config import CANCEL_DIR, EVENT_CHANNEL_PREFIX, EVENT_DIR, REDIS_URL

logger = logging.getLogger("neurolab.worker.events")

try:
    import redis
except ModuleNotFoundError:  # pragma: no cover
    redis = None


class EventPublisher:
    def __init__(self) -> None:
        self._client = None
        self._redis_disabled = redis is None

    def _connect(self):
        if self._redis_disabled or self._client is not None:
            return self._client
        try:
            client = redis.Redis.from_url(REDIS_URL, decode_responses=True)
            client.ping()
            self._client = client
            logger.info("Worker conectado a Redis para telemetría en %s", REDIS_URL)
        except Exception as exc:  # Redis es opcional en modo filesystem
            logger.warning("Redis no disponible para telemetría (%s); se usará el log local.", exc)
            self._redis_disabled = True
        return self._client

    def warm_up(self) -> None:
        """Resuelve la conexión opcional con Redis antes del primer trabajo."""
        self._connect()

    def publish(self, job_id: UUID, event: Dict[str, Any]) -> None:
        event.setdefault("job_id", str(job_id))
        serialized = json.dumps(event, default=str, ensure_ascii=False)
        try:
            path = Path(EVENT_DIR) / f"{job_id}.jsonl"
            with path.open("a", encoding="utf-8") as handle:
                handle.write(serialized + "\n")
        except OSError:
            logger.debug("No fue posible escribir el log local de eventos", exc_info=True)

        client = self._connect()
        if client is not None:
            try:
                client.publish(f"{EVENT_CHANNEL_PREFIX}:{job_id}:events", serialized)
            except Exception:
                logger.warning("Fallo publicando evento en Redis; queda el log local.", exc_info=True)

    def state(
        self,
        job_id: UUID,
        status: str,
        progress: Optional[float] = None,
        error_message: Optional[str] = None,
        metrics_history: Optional[list] = None,
    ) -> None:
        event: Dict[str, Any] = {
            "event": "state",
            "job_id": str(job_id),
            "status": status,
        }
        if progress is not None:
            event["progress"] = float(progress)
        if error_message is not None:
            event["error_message"] = error_message
        if metrics_history is not None:
            event["metrics_history"] = metrics_history
        self.publish(job_id, event)

    def epoch(
        self,
        job_id: UUID,
        epoch: int,
        total_epochs: int,
        metrics: Dict[str, float],
        progress: float,
    ) -> None:
        self.publish(
            job_id,
            {
                "event": "epoch_end",
                "job_id": str(job_id),
                "epoch": int(epoch),
                "total_epochs": int(total_epochs),
                "progress": float(progress),
                "metrics": {key: float(value) for key, value in metrics.items()},
            },
        )


def cancellation_flag(job_id: UUID) -> Path:
    return Path(CANCEL_DIR) / f"{job_id}.flag"


def filesystem_cancel_requested(job_id: UUID) -> bool:
    return cancellation_flag(job_id).exists()


def clear_filesystem_cancel(job_id: UUID) -> None:
    try:
        cancellation_flag(job_id).unlink(missing_ok=True)
    except OSError:
        pass


def redis_cancel_requested(job_id: UUID, publisher: EventPublisher) -> bool:
    client = publisher._connect() if publisher else None
    if client is None:
        return False
    try:
        return bool(client.exists(f"{EVENT_CHANNEL_PREFIX}:{job_id}:cancel"))
    except Exception:
        return False
