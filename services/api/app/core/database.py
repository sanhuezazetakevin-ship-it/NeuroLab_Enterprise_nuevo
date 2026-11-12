from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

engine_kwargs = {"echo": settings.SQL_ECHO, "future": True}
if not settings.DATABASE_URL.startswith("sqlite"):
    engine_kwargs.update(
        {
            "pool_pre_ping": True,
            "pool_recycle": 1800,
            "pool_size": 10,
            "max_overflow": 20,
        }
    )
    # El pooler de transacciones de Supabase (puerto 6543) no soporta
    # sentencias preparadas nombradas. El pooler de sesión (5432) sí; se
    # desactiva la caché solo cuando se detecta el modo transacción.
    if "pooler.supabase.com" in settings.DATABASE_URL and ":6543" in settings.DATABASE_URL:
        engine_kwargs["connect_args"] = {"statement_cache_size": 0}

engine = create_async_engine(settings.DATABASE_URL, **engine_kwargs)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


async def init_db() -> None:
    """Crea el esquema en entornos locales.

    En producción el esquema se aplica con las migraciones de Alembic/SQL
    (infra/migrations y services/api/alembic); create_all sólo actúa como
    atajo de desarrollo para que el MVP sea ejecutable sin pasos manuales.
    """
    from app.repositories import models  # noqa: F401  (registra las tablas)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
