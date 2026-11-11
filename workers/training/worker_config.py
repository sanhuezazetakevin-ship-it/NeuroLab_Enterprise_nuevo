"""Configuración compartida del worker de entrenamiento.

El worker es un proceso aislado de la API: no importa TensorFlow dentro de
FastAPI ni comparte memoria con él. La comunicación se realiza por la cola
(Redis o sistema de archivos) y por la base de datos, que es la fuente de
verdad del estado de cada trabajo.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]
API_DIR = ROOT_DIR / "services" / "api"

# El archivo .env de la raíz es el que usa docker-compose. El de la API se usa
# como respaldo para ejecuciones locales desde services/api.
load_dotenv(ROOT_DIR / ".env")
load_dotenv(API_DIR / ".env")


def _absolute_dir(value: str, default: Path) -> Path:
    path = Path(value) if value else default
    if not path.is_absolute():
        path = (API_DIR / path).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def _sync_database_url(raw: str) -> str:
    """Convierte la URL async de la API en una URL sync para el worker."""
    url = (raw or "").strip()
    if not url:
        url = f"sqlite:///{(API_DIR / 'neurolab_dev.db').as_posix()}"

    if url.startswith("postgresql+asyncpg://"):
        url = url.replace("postgresql+asyncpg://", "postgresql+psycopg2://", 1)
    elif url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+psycopg2://", 1)
    if url.startswith("postgresql+psycopg2://"):
        # La API normaliza a ``ssl=require`` para asyncpg; psycopg2 espera
        # el parámetro libpq ``sslmode``.
        url = url.replace("?ssl=", "?sslmode=").replace("&ssl=", "&sslmode=")
    if url.startswith("postgresql"):
        return url

    for prefix in ("sqlite+aiosqlite:///", "sqlite:///"):
        if url.startswith(prefix):
            raw_path = url[len(prefix) :]
            path = Path(raw_path)
            if not path.is_absolute():
                path = (API_DIR / path).resolve()
            return f"sqlite:///{path.as_posix()}"
    return url


DATABASE_URL = _sync_database_url(os.getenv("DATABASE_URL", ""))

DATA_DIR = _absolute_dir(os.getenv("DATA_DIR", ""), API_DIR / "data" / "uploads")
MODEL_DIR = _absolute_dir(os.getenv("MODEL_DIR", ""), API_DIR / "data" / "models")
TEMP_DIR = _absolute_dir(os.getenv("TEMP_DIR", ""), DATA_DIR / "tmp")

# Almacenamiento compatible con S3 (Supabase Storage, MinIO, R2...). Si está
# desactivado, API y worker deben compartir el mismo volumen local.
STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "local").strip().lower()
S3_ENDPOINT_URL = os.getenv("S3_ENDPOINT_URL", "").strip()
S3_REGION = os.getenv("S3_REGION", "us-east-1").strip()
S3_ACCESS_KEY_ID = os.getenv("S3_ACCESS_KEY_ID", "").strip()
S3_SECRET_ACCESS_KEY = os.getenv("S3_SECRET_ACCESS_KEY", "").strip()
S3_BUCKET = os.getenv("S3_BUCKET", "neurolab").strip()
S3_FORCE_PATH_STYLE = os.getenv("S3_FORCE_PATH_STYLE", "true").strip().lower() in {
    "1",
    "true",
    "yes",
}
USES_S3 = STORAGE_BACKEND in {"s3", "supabase", "minio", "r2"}

QUEUE_BACKEND = os.getenv("QUEUE_BACKEND", "redis").strip().lower()
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
TRAINING_QUEUE = os.getenv("TRAINING_QUEUE", "neurolab:training:queue")
EVENT_CHANNEL_PREFIX = "neurolab:job"

QUEUE_DIR = DATA_DIR / "queue"
PROCESSING_DIR = QUEUE_DIR / "processing"
CANCEL_DIR = DATA_DIR / "cancellations"
EVENT_DIR = DATA_DIR / "events"

MAX_CSV_ROWS = int(os.getenv("MAX_CSV_ROWS", "500000"))
MAX_CSV_COLUMNS = int(os.getenv("MAX_CSV_COLUMNS", "500"))
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "50"))
MAX_FEATURES_AFTER_ENCODING = int(os.getenv("MAX_FEATURES_AFTER_ENCODING", "5000"))

TRAINING_TIMEOUT_SECONDS = int(os.getenv("TRAINING_TIMEOUT_SECONDS", "7200"))
WORKER_HEARTBEAT_TIMEOUT_SECONDS = int(os.getenv("WORKER_HEARTBEAT_TIMEOUT_SECONDS", "900"))
QUEUE_POLL_SECONDS = float(os.getenv("QUEUE_POLL_SECONDS", "2.0"))
CODE_VERSION = os.getenv("CODE_VERSION", "1.0.0")

DEFAULT_TRAIN_SPLIT = 0.70
DEFAULT_VAL_SPLIT = 0.15
DEFAULT_TEST_SPLIT = 0.15


def ensure_directories() -> None:
    for directory in (
        DATA_DIR,
        MODEL_DIR,
        TEMP_DIR,
        QUEUE_DIR,
        PROCESSING_DIR,
        CANCEL_DIR,
        EVENT_DIR,
    ):
        directory.mkdir(parents=True, exist_ok=True)


ensure_directories()
