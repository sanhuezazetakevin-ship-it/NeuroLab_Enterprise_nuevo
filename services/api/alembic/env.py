from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import settings
from app.core.database import Base
from app.repositories import models  # noqa: F401  (registra todas las tablas)

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Modelos ORM como fuente de verdad del esquema.
target_metadata = Base.metadata


def _sync_database_url(url: str) -> str:
    """Convierte URLs async (usadas por la API) a un driver sincrónico para Alembic."""
    url = url.replace("postgresql+asyncpg", "postgresql+psycopg2").replace(
        "sqlite+aiosqlite", "sqlite"
    )
    if url.startswith("postgresql+psycopg2://"):
        # La API usa ``ssl=require`` para asyncpg; psycopg2/Alembic esperan
        # el parámetro libpq ``sslmode``.
        url = url.replace("?ssl=", "?sslmode=").replace("&ssl=", "&sslmode=")
    return url


db_url = _sync_database_url(settings.DATABASE_URL)
# ConfigParser interpola '%', por lo que se escapa para contraseñas especiales.
config.set_main_option("sqlalchemy.url", db_url.replace("%", "%%"))


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    context.configure(
        url=db_url,
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
