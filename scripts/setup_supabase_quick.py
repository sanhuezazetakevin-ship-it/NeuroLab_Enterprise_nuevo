"""Configura Supabase pidiendo solo la contraseña de la base de datos.

Arma la cadena "Session pooler" con el ref y la región del proyecto y delega
en scripts/setup_supabase_db.py (prueba de conexión, migraciones, admin y .env).

Uso:
    python scripts/setup_supabase_quick.py

También acepta la cadena completa si la pegas en el mismo prompt: detecta el
prefijo postgresql:// y extrae la contraseña.
"""

from __future__ import annotations

import argparse
import getpass
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent
SETUP = ROOT / "scripts" / "setup_supabase_db.py"

DEFAULT_REF = "kaqqdfceqsgeznlfzkxa"
DEFAULT_REGION = "us-east-1"
DEFAULT_HOST = "aws-0-{region}.pooler.supabase.com"
DEFAULT_PORT = 5432
DEFAULT_DATABASE = "postgres"
SCHEMES = ("postgresql://", "postgres://", "postgresql+asyncpg://")


def build_url(
    password: str,
    *,
    ref: str = DEFAULT_REF,
    region: str = DEFAULT_REGION,
    host: str = DEFAULT_HOST,
    port: int = DEFAULT_PORT,
    database: str = DEFAULT_DATABASE,
) -> str:
    """Devuelve la URL con la contraseña codificada y SSL obligatorio."""
    user = quote(f"postgres.{ref}", safe="")
    secret = quote(password, safe="")
    resolved_host = host.format(region=region)
    return (
        f"postgresql://{user}:{secret}@{resolved_host}:{port}/{database}"
        "?sslmode=require"
    )


def extract_password(raw: str) -> str | None:
    """Si el usuario pegó la cadena completa, saca la contraseña."""
    text = raw.strip().strip('"').strip("'")
    for scheme in SCHEMES:
        if text.startswith(scheme):
            parsed = urlsplit(text)
            if parsed.password is None:
                raise SystemExit(
                    "La cadena pegada no incluye contraseña. Vuelve a intentarlo "
                    "pegando solo la contraseña."
                )
            return unquote(parsed.password)
    return None


def masked(url: str) -> str:
    """Muestra la URL sin la contraseña."""
    parts = urlsplit(url)
    return f"postgresql://{parts.username}:***@{parts.hostname}:{parts.port}{parts.path}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Configura Supabase Postgres pidiendo solo la contraseña"
    )
    parser.add_argument("--ref", default=DEFAULT_REF, help="Project ref de Supabase")
    parser.add_argument("--region", default=DEFAULT_REGION, help="Región del proyecto")
    parser.add_argument(
        "--host",
        default=DEFAULT_HOST,
        help="Host del pooler; use {region} como marcador",
    )
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--database", default=DEFAULT_DATABASE)
    parser.add_argument(
        "--skip-seed", action="store_true", help="No crear el administrador inicial"
    )
    parser.add_argument(
        "--check-only", action="store_true", help="Solo probar la conexión"
    )
    parser.add_argument(
        "--print-only",
        action="store_true",
        help="Mostrar la URL enmascarada sin conectarse (diagnóstico)",
    )
    args = parser.parse_args(argv)

    raw = os.environ.get("SUPABASE_DB_PASSWORD", "")
    if raw:
        password = raw.strip()
    else:
        print("Escribe o pega SOLO la contraseña de la base de datos de Supabase.")
        print("Si no la recuerdas: Dashboard -> Settings -> Database -> Reset password.")
        print("(No se mostrará en pantalla. Pulsa Enter al terminar).\n")
        try:
            entered = getpass.getpass("Contraseña de la base de datos: ")
        except (KeyboardInterrupt, EOFError):
            print("\nCancelado.")
            return 1
        password = (extract_password(entered) or entered).strip()

    if not password:
        print(
            "\nNo se recibió ninguna contraseña.\n"
            "Sugerencia: si el pegado no funciona en esta ventana, escribe\n"
            "  set SUPABASE_DB_PASSWORD=tu_contraseña\n"
            "y vuelve a ejecutar el script."
        )
        return 1

    url = build_url(
        password,
        ref=args.ref,
        region=args.region,
        host=args.host,
        port=args.port,
        database=args.database,
    )
    print(f"\nConexión a usar: {masked(url)}")

    if args.print_only:
        return 0

    env = os.environ.copy()
    env["DATABASE_URL"] = url
    command = [sys.executable, str(SETUP), "--write-env"]
    if args.skip_seed:
        command.append("--skip-seed")
    if args.check_only:
        command.append("--check-only")

    return subprocess.call(command, cwd=ROOT, env=env)


if __name__ == "__main__":
    raise SystemExit(main())
