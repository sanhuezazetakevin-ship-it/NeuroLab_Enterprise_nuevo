import json
from functools import lru_cache
from pathlib import Path
from typing import Annotated, List, Optional

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]  # services/api (o /app en Docker)
ROOT_DIR = BASE_DIR.parents[1] if len(BASE_DIR.parents) > 1 else BASE_DIR


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Un único .env en la raíz sirve para API, worker y Docker Compose.
        # services/api/.env puede sobreescribir valores para ejecuciones locales.
        env_file=(ROOT_DIR / ".env", BASE_DIR / ".env"),
        case_sensitive=True,
        extra="ignore",
        validate_default=True,
    )

    PROJECT_NAME: str = "NeuroLab Enterprise API"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    ENVIRONMENT: str = "development"
    LOG_LEVEL: str = "INFO"
    # El eco de SQL es útil para depurar pero multiplica el I/O y el tamaño de
    # los logs. Se activa explícitamente con SQL_ECHO=true.
    SQL_ECHO: bool = False

    SECRET_KEY: str = "neurolab_insecure_default_secret_key_change_me_32chars"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    LOGIN_RATE_LIMIT_PER_MINUTE: int = 10
    # Bloqueo temporal por cuenta tras varios fallos consecutivos.
    LOGIN_MAX_FAILED_ATTEMPTS: int = 5
    LOGIN_LOCKOUT_SECONDS: int = 900
    # Sólo se confía en X-Forwarded-For cuando la conexión viene de uno de
    # estos proxies. En Docker, añada la subred del proxy (p. ej. 172.16.0.0/12).
    TRUSTED_PROXY_IPS: Annotated[List[str], NoDecode] = ["127.0.0.1", "::1"]
    # Vida del ticket de un solo uso para SSE/WebSocket.
    STREAM_TICKET_TTL_SECONDS: int = 30

    POSTGRES_USER: str = "neurolab"
    POSTGRES_PASSWORD: str = "neurolab_secure_pass"
    POSTGRES_DB: str = "neurolab_db"
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432
    DATABASE_URL: str = (
        f"postgresql+asyncpg://{POSTGRES_USER}:{POSTGRES_PASSWORD}"
        f"@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"
    )

    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_URL: str = f"redis://{REDIS_HOST}:{REDIS_PORT}/0"
    TRAINING_QUEUE: str = "neurolab:training:queue"
    # "filesystem" escribe descriptores en DATA_DIR/queue y no requiere Redis.
    # Debe coincidir con QUEUE_BACKEND del worker para que consuma los jobs.
    QUEUE_BACKEND: str = "redis"
    QUEUE_POLL_SECONDS: float = 2.0

    DATA_DIR: str = str(BASE_DIR / "data" / "uploads")
    MODEL_DIR: str = str(BASE_DIR / "data" / "models")
    MAX_UPLOAD_MB: int = 50
    MAX_CSV_ROWS: int = 500_000
    MAX_CSV_COLUMNS: int = 500

    # Gobierno de inferencia: en producción conviene exigir modelos aprobados.
    INFERENCE_REQUIRE_APPROVED: bool = False

    # Object storage. "local" usa DATA_DIR/MODEL_DIR; "s3" usa un bucket
    # compatible con S3 (Supabase Storage, MinIO, AWS S3, R2, etc.).
    STORAGE_BACKEND: str = "local"
    S3_ENDPOINT_URL: str = ""
    S3_REGION: str = "us-east-1"
    S3_ACCESS_KEY_ID: str = ""
    S3_SECRET_ACCESS_KEY: str = ""
    S3_BUCKET: str = "neurolab"
    S3_FORCE_PATH_STYLE: bool = True

    # Bootstrap account. La contraseña no tiene valor por defecto: si no se
    # define SEED_ADMIN_PASSWORD, `ensure_seed_admin` genera una aleatoria y la
    # muestra una sola vez en los logs del primer arranque.
    SEED_ADMIN_EMAIL: str = "admin@neurolab.enterprise"
    SEED_ADMIN_PASSWORD: Optional[str] = None
    SEED_ADMIN_NAME: str = "Administrador NeuroLab"

    # NoDecode evita que pydantic-settings intente interpretar el valor como
    # JSON antes de nuestro validador. Así se aceptan tanto listas separadas
    # por comas (formato histórico del .env y Docker Compose) como JSON.
    CORS_ORIGINS: Annotated[List[str], NoDecode] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
    ]
    CORS_ORIGIN_REGEX: str = ""

    @field_validator("CORS_ORIGINS", "TRUSTED_PROXY_IPS", mode="before")
    @classmethod
    def _split_origins(cls, value):
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return []
            if text.startswith("["):
                try:
                    parsed = json.loads(text)
                except json.JSONDecodeError:
                    parsed = None
                if isinstance(parsed, list):
                    return [
                        str(item).strip() for item in parsed if str(item).strip()
                    ]
            return [item.strip() for item in text.split(",") if item.strip()]
        return value

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def _normalize_database_url(cls, value):
        """Normaliza la URL para SQLAlchemy asyncpg.

        Supabase entrega URLs ``postgresql://`` con ``sslmode=require``. El
        driver asyncpg espera el parámetro ``ssl``; Alembic y psycopg2 vuelven
        a convertir ``ssl`` en ``sslmode`` en sus propios módulos.
        """
        url = (value or "").strip()
        if not url:
            return value
        if url.startswith("postgres://"):
            url = "postgresql+asyncpg://" + url[len("postgres://") :]
        elif url.startswith("postgresql://"):
            url = "postgresql+asyncpg://" + url[len("postgresql://") :]
        if url.startswith("postgresql+asyncpg://"):
            url = url.replace("sslmode=", "ssl=")
            if (
                "pooler.supabase.com" in url
                and ":6543" in url
                and "prepared_statement_cache_size=" not in url
            ):
                separator = "&" if "?" in url else "?"
                url += f"{separator}prepared_statement_cache_size=0"
        return url

    @property
    def upload_path(self) -> Path:
        path = Path(self.DATA_DIR)
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def model_path(self) -> Path:
        path = Path(self.MODEL_DIR)
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT.lower() in {"production", "prod"}

    @property
    def uses_s3(self) -> bool:
        return self.STORAGE_BACKEND.strip().lower() in {"s3", "supabase", "minio", "r2"}


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if settings.is_production:
        insecure_keys = {
            "neurolab_insecure_default_secret_key_change_me_32chars",
            "change_this_to_a_super_secret_enterprise_key_in_production_32chars",
        }
        if (
            settings.SECRET_KEY in insecure_keys
            or "insecure_default" in settings.SECRET_KEY
            or len(settings.SECRET_KEY) < 32
        ):
            raise RuntimeError(
                "SECRET_KEY insegura o de ejemplo detectada en producción. "
                "Configure una clave criptográfica de al menos 32 caracteres."
            )
        if (
            not settings.SEED_ADMIN_PASSWORD
            or settings.SEED_ADMIN_PASSWORD in {"Admin123!", "admin", "password"}
            or len(settings.SEED_ADMIN_PASSWORD) < 12
        ):
            raise RuntimeError(
                "SEED_ADMIN_PASSWORD ausente o insegura en producción. "
                "Defina una contraseña robusta (mínimo 12 caracteres) para el administrador inicial."
            )
    return settings


settings = get_settings()
