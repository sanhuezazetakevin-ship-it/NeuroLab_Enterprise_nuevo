"""Almacenamiento de datasets y artefactos para el worker aislado.

El worker puede ejecutarse en otro host distinto de la API. En ese caso ambos
procesos comparten un bucket compatible con S3 (Supabase Storage, MinIO,
AWS S3 o R2) bajo las claves ``datasets/...`` y ``models/...``.
"""

from __future__ import annotations

import logging
import shutil
from pathlib import Path, PurePosixPath
from typing import Optional

from worker_config import (
    DATA_DIR,
    MODEL_DIR,
    S3_ACCESS_KEY_ID,
    S3_BUCKET,
    S3_ENDPOINT_URL,
    S3_FORCE_PATH_STYLE,
    S3_REGION,
    S3_SECRET_ACCESS_KEY,
    USES_S3,
)

logger = logging.getLogger("neurolab.object_storage")

ALLOWED_PREFIXES = {"datasets", "models"}


class ObjectStorageError(RuntimeError):
    pass


def validate_key(key: str) -> str:
    normalized = (key or "").replace("\\", "/").strip().lstrip("/")
    path = PurePosixPath(normalized)
    if not normalized or path.is_absolute() or ".." in path.parts:
        raise ObjectStorageError("Clave de almacenamiento inválida")
    if not path.parts or path.parts[0] not in ALLOWED_PREFIXES:
        raise ObjectStorageError("La clave debe comenzar por datasets/ o models/")
    return path.as_posix()


def _local_base(key: str) -> Path:
    base = MODEL_DIR if key.startswith("models/") else DATA_DIR
    return Path(base).resolve()


def _local_path(key: str) -> Path:
    base = _local_base(key)
    candidate = (base / key).resolve()
    if candidate != base and base not in candidate.parents:
        raise ObjectStorageError("Ruta fuera del almacenamiento permitido")
    return candidate


class WorkerObjectStorage:
    def __init__(self) -> None:
        self._client = None

    @property
    def enabled(self) -> bool:
        return USES_S3

    def _s3_client(self):
        if self._client is not None:
            return self._client
        missing = [
            name
            for name, value in (
                ("S3_ENDPOINT_URL", S3_ENDPOINT_URL),
                ("S3_ACCESS_KEY_ID", S3_ACCESS_KEY_ID),
                ("S3_SECRET_ACCESS_KEY", S3_SECRET_ACCESS_KEY),
                ("S3_BUCKET", S3_BUCKET),
            )
            if not value
        ]
        if missing:
            raise ObjectStorageError(
                "Configuración S3 incompleta; faltan: " + ", ".join(missing)
            )
        try:
            import boto3
            from botocore.config import Config
        except ImportError as exc:  # pragma: no cover - dependencia de despliegue
            raise ObjectStorageError("boto3 no está instalado en el worker") from exc

        self._client = boto3.client(
            "s3",
            endpoint_url=S3_ENDPOINT_URL,
            region_name=S3_REGION,
            aws_access_key_id=S3_ACCESS_KEY_ID,
            aws_secret_access_key=S3_SECRET_ACCESS_KEY,
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "path" if S3_FORCE_PATH_STYLE else "auto"},
            ),
        )
        return self._client

    def download_to(self, key: str, destination: Path) -> Path:
        key = validate_key(key)
        destination = Path(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)

        if not USES_S3:
            source = _local_path(key)
            if not source.exists():
                raise ObjectStorageError("El dataset no existe en el almacenamiento compartido")
            shutil.copyfile(source, destination)
            return destination

        try:
            self._s3_client().download_file(S3_BUCKET, key, str(destination))
        except Exception as exc:
            raise ObjectStorageError(
                f"No fue posible descargar {key} desde el bucket: {exc}"
            ) from exc
        return destination

    def put_file(
        self,
        local_path: Path,
        key: str,
        content_type: Optional[str] = None,
    ) -> str:
        key = validate_key(key)
        source = Path(local_path)
        if not source.exists():
            raise ObjectStorageError(f"No existe el archivo local {source}")

        if not USES_S3:
            destination = _local_path(key)
            destination.parent.mkdir(parents=True, exist_ok=True)
            if source.resolve() != destination.resolve():
                shutil.copyfile(source, destination)
            return key

        extra = {"ContentType": content_type} if content_type else {}
        try:
            self._s3_client().upload_file(
                str(source), S3_BUCKET, key, ExtraArgs=extra
            )
        except Exception as exc:
            raise ObjectStorageError(
                f"No fue posible subir {key} al bucket: {exc}"
            ) from exc
        return key

    def delete(self, key: str) -> None:
        key = validate_key(key)
        if not USES_S3:
            _local_path(key).unlink(missing_ok=True)
            return
        try:
            self._s3_client().delete_object(Bucket=S3_BUCKET, Key=key)
        except Exception as exc:
            raise ObjectStorageError(f"No fue posible eliminar {key}: {exc}") from exc


object_storage = WorkerObjectStorage()
