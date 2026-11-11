"""Pruebas del almacenamiento local y de la normalización de URLs cloud."""

from __future__ import annotations

import pytest

from app.core.config import Settings
from app.core.storage import StorageError, storage, validate_key


def test_local_storage_roundtrip_and_delete():
    key = "datasets/00000000-0000-0000-0000-000000000001/test.csv"
    payload = b"a,b\n1,2\n"

    storage.put_bytes(key, payload, "text/csv")
    assert storage.exists(key) is True
    assert storage.get_bytes(key) == payload

    storage.delete(key)
    assert storage.exists(key) is False


def test_storage_rejects_path_traversal_and_unknown_prefix():
    with pytest.raises(StorageError):
        validate_key("../etc/passwd")
    with pytest.raises(StorageError):
        validate_key("secrets/credentials.txt")
    with pytest.raises(StorageError):
        storage.get_bytes("datasets/../../etc/passwd")


def test_supabase_database_url_is_normalized_for_asyncpg():
    settings = Settings(
        _env_file=None,
        DATABASE_URL=(
            "postgresql://postgres.ref:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
            "?sslmode=require"
        ),
    )
    assert settings.DATABASE_URL.startswith("postgresql+asyncpg://")
    assert "ssl=require" in settings.DATABASE_URL
    assert "sslmode=" not in settings.DATABASE_URL


def test_cors_origins_accepts_comma_separated_values():
    settings = Settings(_env_file=None, CORS_ORIGINS="http://a.test,http://b.test")
    assert settings.CORS_ORIGINS == ["http://a.test", "http://b.test"]


def test_cors_origins_accepts_json_list():
    settings = Settings(_env_file=None, CORS_ORIGINS='["http://a.test", "http://b.test"]')
    assert settings.CORS_ORIGINS == ["http://a.test", "http://b.test"]


def test_supabase_transaction_pooler_disables_prepared_statements():
    settings = Settings(
        _env_file=None,
        DATABASE_URL=(
            "postgresql://postgres.ref:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres"
            "?sslmode=require"
        ),
    )
    assert "prepared_statement_cache_size=0" in settings.DATABASE_URL


def test_queue_backend_comes_from_settings_not_raw_environment():
    """Regresión: el .env de pydantic debe gobernar la cola de la API.

    Antes ``queue.py`` usaba ``os.getenv`` y, al no existir la variable en el
    proceso, caía en Redis aunque el .env dijera ``QUEUE_BACKEND=filesystem``.
    """
    from app.core.config import Settings, settings
    from app.modules.training.queue import training_queue

    assert Settings(_env_file=None, QUEUE_BACKEND="filesystem").QUEUE_BACKEND == "filesystem"
    assert training_queue.backend == (settings.QUEUE_BACKEND or "redis").strip().lower()
    assert training_queue.backend == "filesystem"
