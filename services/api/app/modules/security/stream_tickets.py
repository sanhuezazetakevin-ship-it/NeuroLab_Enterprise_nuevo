"""Tickets de un solo uso para los canales SSE y WebSocket.

Un JWT en la URL queda registrado en los logs de Nginx, proxies y plataformas
de despliegue. En su lugar, el cliente autenticado solicita un ticket opaco de
vida corta (30 s por defecto) y lo consume al abrir el stream. El ticket se
invalida al primer uso.

En producción se guarda en Redis (``GETDEL`` atómico). Sin Redis —por ejemplo
en desarrollo con ``QUEUE_BACKEND=filesystem``— se usa un almacén en memoria
con caducidad, suficiente para un único proceso de API.
"""

from __future__ import annotations

import json
import logging
import secrets
import time
from typing import Dict, Optional, Tuple

from app.core.config import settings
from app.modules.training.queue import redis_client

logger = logging.getLogger(__name__)

TICKET_PREFIX = "neurolab:stream-ticket:"

# ticket -> (expira_en_monotonic, payload)
_LOCAL_TICKETS: Dict[str, Tuple[float, dict]] = {}


def _redis_enabled() -> bool:
    return (settings.QUEUE_BACKEND or "").strip().lower() == "redis"


def _prune_local() -> None:
    now = time.monotonic()
    expired = [key for key, (expires, _) in _LOCAL_TICKETS.items() if expires <= now]
    for key in expired:
        _LOCAL_TICKETS.pop(key, None)


async def issue_stream_ticket(*, job_id: str, user_id: str) -> str:
    """Genera un ticket de un solo uso ligado al trabajo y al usuario."""
    ticket = secrets.token_urlsafe(32)
    payload = {"job_id": str(job_id), "user_id": str(user_id)}
    ttl = max(5, int(settings.STREAM_TICKET_TTL_SECONDS))

    client = await redis_client() if _redis_enabled() else None
    if client is not None:
        try:
            await client.set(TICKET_PREFIX + ticket, json.dumps(payload), ex=ttl)
            return ticket
        except Exception:
            # Si Redis falla, el stream seguirá funcionando con el respaldo
            # en memoria y el sondeo a PostgreSQL.
            logger.warning("Redis no disponible al emitir ticket; se usa respaldo en memoria", exc_info=True)
        finally:
            await client.aclose()

    _LOCAL_TICKETS[ticket] = (time.monotonic() + ttl, payload)
    return ticket


async def consume_stream_ticket(*, ticket: str, job_id: str) -> Optional[dict]:
    """Consume el ticket (una sola vez) y valida que corresponda al trabajo."""
    if not ticket:
        return None

    client = await redis_client() if _redis_enabled() else None
    if client is not None:
        try:
            raw = await client.getdel(TICKET_PREFIX + ticket)
            if raw:
                payload = json.loads(raw)
                return payload if payload.get("job_id") == str(job_id) else None
        except Exception:
            logger.warning("Redis no disponible al consumir ticket; se usa respaldo en memoria", exc_info=True)
        finally:
            await client.aclose()

    _prune_local()
    entry = _LOCAL_TICKETS.pop(ticket, None)
    if not entry:
        return None
    expires, payload = entry
    if expires <= time.monotonic():
        return None
    return payload if payload.get("job_id") == str(job_id) else None
