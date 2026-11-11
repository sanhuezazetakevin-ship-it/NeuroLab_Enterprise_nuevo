import asyncio
import json
import time
from pathlib import Path

from app.core.config import settings

try:
    import redis.asyncio as aioredis
except ModuleNotFoundError:  # pragma: no cover - entorno mínimo
    aioredis = None


class QueueUnavailableError(RuntimeError):
    pass


class TrainingQueue:
    """Cola de trabajos con backend Redis (producción) o filesystem (desarrollo).

    El backend filesystem mantiene el aislamiento del proceso de ML (la API sólo
    escribe un descriptor y un worker independiente lo consume). No se ejecuta
    TensorFlow dentro de la API en ningún modo.
    """

    def __init__(self) -> None:
        # Se lee de settings para que el .env de pydantic cuente igual que las
        # variables de entorno del contenedor. Antes os.getenv ignoraba el .env
        # y la API caía siempre en Redis aunque QUEUE_BACKEND=filesystem.
        self.backend = (settings.QUEUE_BACKEND or "redis").strip().lower()
        self.queue_dir = Path(settings.DATA_DIR) / "queue"
        self.cancel_dir = Path(settings.DATA_DIR) / "cancellations"
        self.queue_dir.mkdir(parents=True, exist_ok=True)
        self.cancel_dir.mkdir(parents=True, exist_ok=True)
        self._redis = None

    async def _client(self):
        if aioredis is None:
            return None
        if self._redis is None:
            self._redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        return self._redis

    async def enqueue(self, payload: dict) -> None:
        if self.backend == "filesystem":
            target = self.queue_dir / f"{int(time.time() * 1000)}-{payload['job_id']}.json"
            target.write_text(json.dumps(payload), encoding="utf-8")
            return

        client = await self._client()
        if client is None:
            raise QueueUnavailableError("Cliente Redis no disponible")
        try:
            await client.rpush(settings.TRAINING_QUEUE, json.dumps(payload))
        except Exception as exc:  # conexión rechazada, DNS, etc.
            raise QueueUnavailableError(
                "La cola de entrenamientos no está disponible. Verifique Redis."
            ) from exc

    async def request_cancel(self, job_id: str) -> None:
        if self.backend == "filesystem":
            (self.cancel_dir / f"{job_id}.flag").write_text("1", encoding="utf-8")
            return

        client = await self._client()
        if client is None:
            raise QueueUnavailableError("Cliente Redis no disponible")
        try:
            await client.set(f"neurolab:job:{job_id}:cancel", "1", ex=3600)
            await client.publish(
                f"neurolab:job:{job_id}:control", json.dumps({"action": "CANCEL"})
            )
        except Exception as exc:
            raise QueueUnavailableError(
                "No fue posible notificar la cancelación al worker."
            ) from exc

    async def discard_job(self, job_id: str) -> None:
        """Retira de la cola un trabajo que todavía no fue reclamado.

        Se usa al cancelar trabajos en estado QUEUED para que ningún worker los
        recoja después. Es best-effort: si la limpieza falla, el worker igual
        los descarta al ver el estado CANCELLED en la base.
        """
        if self.backend == "filesystem":
            for candidate in self.queue_dir.glob(f"*-{job_id}.json"):
                try:
                    candidate.unlink()
                except FileNotFoundError:
                    continue
            return

        client = await self._client()
        if client is None:
            raise QueueUnavailableError("Cliente Redis no disponible")
        try:
            for raw in await client.lrange(settings.TRAINING_QUEUE, 0, -1):
                try:
                    payload = json.loads(raw)
                except (TypeError, ValueError):
                    continue
                if str(payload.get("job_id")) == job_id:
                    await client.lrem(settings.TRAINING_QUEUE, 0, raw)
        except Exception as exc:
            raise QueueUnavailableError(
                "No fue posible retirar el trabajo de la cola."
            ) from exc

    async def close(self) -> None:
        if self._redis is not None:
            await self._redis.aclose()
            self._redis = None


training_queue = TrainingQueue()

# Caché breve del estado de Redis para que los paneles de salud no paguen un
# timeout de conexión en cada petición. (instante_monotónico, disponible)
_redis_health_cache: tuple[float, bool] | None = None


async def redis_client(timeout: float = 1.0):
    if aioredis is None:
        return None
    client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    try:
        await asyncio.wait_for(client.ping(), timeout=timeout)
        return client
    except Exception:
        await client.aclose()
        return None


async def redis_health(timeout: float = 0.25, cache_seconds: float = 5.0) -> bool:
    """Comprueba Redis con un timeout corto y memoriza el resultado unos segundos.

    Cuando Redis no está desplegado (demo con cola filesystem) el chequeo falla
    rápido y las peticiones siguientes no vuelven a esperar la conexión.
    """
    global _redis_health_cache
    now = time.monotonic()
    if _redis_health_cache is not None and now - _redis_health_cache[0] < cache_seconds:
        return _redis_health_cache[1]
    client = await redis_client(timeout=timeout)
    ok = client is not None
    if client is not None:
        await client.aclose()
    _redis_health_cache = (now, ok)
    return ok
