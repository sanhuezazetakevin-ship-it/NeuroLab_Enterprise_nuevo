"""Comandos operativos de la API (se ejecutan dentro del contenedor).

Uso:
    python -m app.cli seed-admin
"""

from __future__ import annotations

import argparse
import asyncio
import logging

from app.core.bootstrap import ensure_seed_admin
from app.core.config import settings
from app.core.database import engine

logger = logging.getLogger("neurolab.cli")


async def _seed_admin() -> None:
    await ensure_seed_admin()
    await engine.dispose()
    logger.info(
        "Seed verificado: si la tabla users estaba vacía, se creó %s",
        settings.SEED_ADMIN_EMAIL,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Comandos operativos NeuroLab")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser(
        "seed-admin",
        help="Crea el administrador inicial solo si no existe ningún usuario",
    )
    args = parser.parse_args(argv)

    if args.command == "seed-admin":
        asyncio.run(_seed_admin())
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
