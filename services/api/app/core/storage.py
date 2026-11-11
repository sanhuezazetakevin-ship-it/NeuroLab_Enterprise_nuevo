"""Abstracción de almacenamiento para datasets y artefactos de modelo.

En desarrollo se usa el sistema de archivos (``DATA_DIR``/``MODEL_DIR``). En
despliegues con API y worker en hosts distintos se usa un bucket compatible
con S3 (Supabase Storage, MinIO, AWS S3 o Cloudflare R2), de modo que ambos
procesos vean exactamente los mismos archivos.
"""

from __future__ import annotations

import logging
from pathlib import Path, PurePosixPath
from typing import Optional

from app.core.config import settings

logger = logging.getLogger("neurolab.storage")

ALLOWED_PREFIXES = {"datasets", "models"}


class StorageError(RuntimeError):
    """Error controlado de lectura/escritura en el almacenamiento."""


def validate_key(key: str) -> str:
    normalized = (key or "").replace("\\", "/").strip().lstrip("/")
    path = PurePosixPath(normalized)
    if not normalized or path.is_absolute() or ".." in path.parts:
        raise StorageError("Clave de almacenamiento inválida")
    if not path.parts or path.parts[0] not in ALLOWED_PREFIXES:
        raise StorageError("La clave debe comenzar por datasets/ o models/")
    return path.as_posix()


def _local_base(key: str) -> Path:
    base = settings.MODEL_DIR if key.startswith("models/") else settings.DATA_DIR
    return Path(base).resolve()


def _local_path(key: str) -> Path:
    base = _local_base(key)
    candidate = (base / key).resolve()
    if candidate != base and base not in candidate.parents:
        raise StorageError("Ruta de almacenamiento fuera del directorio permitido")
    return candidate


class StorageService:
    def __init__(self) -> None:
        self._client = None

    # ------------------------------------------------------------------
    # S3 / Supabase Storage
    # ------------------------------------------------------------------
    @property
    def backend(self) -> str:
        return "s3" if settings.uses_s3 else "local"

    def _s3_client(self):
        if self._client is not None:
            return self._client
        missing = [
            name
            for name, value in (
                ("S3_ENDPOINT_URL", settings.S3_ENDPOINT_URL),
                ("S3_ACCESS_KEY_ID", settings.S3_ACCESS_KEY_ID),
                ("S3_SECRET_ACCESS_KEY", settings.S3_SECRET_ACCESS_KEY),
                ("S3_BUCKET", settings.S3_BUCKET),
            )
            if not value
        ]
        if missing:
            raise StorageError(
                "Configuración S3 incompleta; faltan: " + ", ".join(missing)
            )
        try:
            import boto3
            from botocore.config import Config
        except ImportError as exc:  # pragma: no cover - dependencia de despliegue
            raise StorageError("boto3 no está instalado en la API") from exc

        self._client = boto3.client(
            "s3",
            endpoint_url=settings.S3_ENDPOINT_URL,
            region_name=settings.S3_REGION,
            aws_access_key_id=settings.S3_ACCESS_KEY_ID,
            aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY,
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "path" if settings.S3_FORCE_PATH_STYLE else "auto"},
            ),
        )
        return self._client

    # ------------------------------------------------------------------
    # API pública
    # ------------------------------------------------------------------
    def put_bytes(
        self,
        key: str,
        data: bytes,
        content_type: Optional[str] = None,
    ) -> str:
        key = validate_key(key)
        if settings.uses_s3:
            extra = {"ContentType": content_type} if content_type else {}
            try:
                self._s3_client().put_object(
                    Bucket=settings.S3_BUCKET, Key=key, Body=data, **extra
                )
            except Exception as exc:
                raise StorageError(f"No fue posible subir {key} al bucket: {exc}") from exc
            return key

        destination = _local_path(key)
        try:
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
        except OSError as exc:
            raise StorageError(f"No fue posible escribir {key}: {exc}") from exc
        return key

    def get_bytes(self, key: str) -> bytes:
        key = validate_key(key)
        if settings.uses_s3:
            try:
                response = self._s3_client().get_object(
                    Bucket=settings.S3_BUCKET, Key=key
                )
                return response["Body"].read()
            except Exception as exc:
                raise StorageError(f"No fue posible leer {key} del bucket: {exc}") from exc

        source = _local_path(key)
        if not source.exists():
            raise StorageError("El archivo solicitado no existe en almacenamiento")
        try:
            return source.read_bytes()
        except OSError as exc:
            raise StorageError(f"No fue posible leer {key}: {exc}") from exc

    def delete(self, key: str) -> None:
        key = validate_key(key)
        if settings.uses_s3:
            try:
                self._s3_client().delete_object(Bucket=settings.S3_BUCKET, Key=key)
            except Exception as exc:
                raise StorageError(f"No fue posible eliminar {key}: {exc}") from exc
            return

        target = _local_path(key)
        try:
            target.unlink(missing_ok=True)
        except OSError as exc:
            raise StorageError(f"No fue posible eliminar {key}: {exc}") from exc

    def exists(self, key: str) -> bool:
        key = validate_key(key)
        if not settings.uses_s3:
            return _local_path(key).exists()
        try:
            self._s3_client().head_object(Bucket=settings.S3_BUCKET, Key=key)
            return True
        except Exception:
            return False


storage = StorageService()
