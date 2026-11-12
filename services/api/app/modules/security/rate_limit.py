"""Límite de intentos de inicio de sesión y bloqueo temporal por cuenta.

El contador se guarda en Redis cuando está disponible para que sobreviva a
reinicios y sea compartido entre instancias. Sin Redis se usa un contador en
memoria (desarrollo y tests).

La IP del cliente sólo se toma de ``X-Forwarded-For`` cuando la conexión
proviene de un proxy declarado en ``TRUSTED_PROXY_IPS``; así un cliente no
puede falsificar su IP enviando la cabecera directamente.
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import time
from collections import defaultdict, deque
from typing import Deque, Dict, Optional

from fastapi import HTTPException, Request, status

from app.core.config import settings
from app.modules.training.queue import redis_client

logger = logging.getLogger(__name__)

IP_WINDOW_SECONDS = 60


def _is_trusted(ip: str, entries: list[str]) -> bool:
    """Acepta direcciones y rangos CIDR (p. ej. la subred de Docker)."""
    try:
        address = ipaddress.ip_address(ip)
    except ValueError:
        return False
    for entry in entries:
        try:
            if address in ipaddress.ip_network(entry, strict=False):
                return True
        except ValueError:
            continue
    return False


def client_ip(request: Request) -> str:
    peer = request.client.host if request.client else "unknown"
    trusted = [ip.strip() for ip in settings.TRUSTED_PROXY_IPS if ip.strip()]
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded and _is_trusted(peer, trusted):
        hops = [hop.strip() for hop in forwarded.split(",") if hop.strip()]
        for hop in reversed(hops):
            if not _is_trusted(hop, trusted):
                return hop
        if hops:
            return hops[0]
    return peer


def _redis_enabled() -> bool:
    return (settings.QUEUE_BACKEND or "").strip().lower() == "redis"


class LoginRateLimiter:
    def __init__(self) -> None:
        # Respaldo en memoria cuando Redis no está disponible.
        self._hits: Dict[str, Deque[float]] = defaultdict(deque)
        self._failures: Dict[str, Deque[float]] = defaultdict(deque)
        self._lock = asyncio.Lock()

    # --------------------------------------------------------- Redis helpers
    async def _redis_count(self, key: str, window: int) -> Optional[int]:
        if not _redis_enabled():
            return None
        client = await redis_client()
        if client is None:
            return None
        try:
            count = int(await client.incr(key))
            if count == 1:
                await client.expire(key, window)
            return count
        except Exception:
            return None
        finally:
            await client.aclose()

    async def _redis_get(self, key: str) -> Optional[int]:
        if not _redis_enabled():
            return None
        client = await redis_client()
        if client is None:
            return None
        try:
            value = await client.get(key)
            return int(value) if value is not None else 0
        except Exception:
            return None
        finally:
            await client.aclose()

    async def _redis_delete(self, key: str) -> None:
        if not _redis_enabled():
            return
        client = await redis_client()
        if client is None:
            return
        try:
            await client.delete(key)
        except Exception:
            logger.warning("No fue posible limpiar la clave de rate limit en Redis", exc_info=True)
        finally:
            await client.aclose()

    # --------------------------------------------------------- Memory helpers
    def _memory_hit(self, key: str, window: int) -> int:
        now = time.monotonic()
        hits = self._hits[key]
        while hits and now - hits[0] > window:
            hits.popleft()
        hits.append(now)
        return len(hits)

    def _memory_count(self, key: str, window: int) -> int:
        now = time.monotonic()
        hits = self._failures[key]
        while hits and now - hits[0] > window:
            hits.popleft()
        return len(hits)

    def _memory_bump(self, key: str, window: int) -> int:
        now = time.monotonic()
        hits = self._failures[key]
        while hits and now - hits[0] > window:
            hits.popleft()
        hits.append(now)
        return len(hits)

    # ----------------------------------------------------------------- Public
    async def check(self, request: Request, email: Optional[str] = None) -> None:
        """Cuenta el intento por IP y rechaza si la cuenta está bloqueada."""
        ip = client_ip(request)
        limit = settings.LOGIN_RATE_LIMIT_PER_MINUTE
        if limit > 0:
            count = await self._redis_count(f"neurolab:login:ip:{ip}", IP_WINDOW_SECONDS)
            async with self._lock:
                if count is None:
                    count = self._memory_hit(f"ip:{ip}", IP_WINDOW_SECONDS)
            if count > limit:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Demasiados intentos de inicio de sesión. Intente más tarde.",
                    headers={"Retry-After": str(IP_WINDOW_SECONDS)},
                )

        if email:
            await self._assert_account_allowed(email)

    async def register_failure(self, email: str) -> None:
        """Registra un fallo de credenciales y bloquea la cuenta si se excede."""
        if not email:
            return
        limit = max(1, settings.LOGIN_MAX_FAILED_ATTEMPTS)
        window = max(60, settings.LOGIN_LOCKOUT_SECONDS)

        current = await self._redis_get(f"neurolab:login:fail:{email}")
        if current is not None:
            # No se refresca el TTL una vez bloqueada: el bloqueo caduca solo.
            if current >= limit:
                return
            await self._redis_count(f"neurolab:login:fail:{email}", window)
            return

        async with self._lock:
            if self._memory_count(f"account:{email}", window) >= limit:
                return
            self._memory_bump(f"account:{email}", window)

    async def reset_failures(self, email: str) -> None:
        """Limpia el contador tras un inicio de sesión correcto."""
        if not email:
            return
        await self._redis_delete(f"neurolab:login:fail:{email}")
        async with self._lock:
            self._failures.pop(f"account:{email}", None)

    async def _assert_account_allowed(self, email: str) -> None:
        limit = max(1, settings.LOGIN_MAX_FAILED_ATTEMPTS)
        window = max(60, settings.LOGIN_LOCKOUT_SECONDS)
        count = await self._redis_get(f"neurolab:login:fail:{email}")
        if count is None:
            async with self._lock:
                count = self._memory_count(f"account:{email}", window)
        if count >= limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=(
                    "La cuenta está bloqueada temporalmente por demasiados intentos "
                    "fallidos. Intente de nuevo más tarde."
                ),
                headers={"Retry-After": str(window)},
            )


login_rate_limiter = LoginRateLimiter()
