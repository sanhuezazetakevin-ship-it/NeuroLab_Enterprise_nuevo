"""Configura la base de datos de Supabase para NeuroLab Enterprise.

Uso recomendado (la contraseña no se muestra y se guarda en .env ignorado):

    python scripts/setup_supabase_db.py --write-env

También puede leer la cadena desde la variable DATABASE_URL:

    $env:DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require"
    python scripts/setup_supabase_db.py

El script:
1. Valida la cadena y prueba la conexión.
2. Aplica las migraciones Alembic.
3. Crea el administrador inicial solo si la tabla users está vacía.
4. Opcionalmente guarda la conexión en .env y muestra cómo arrancar la app.
"""

from __future__ import annotations

import argparse
import getpass
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parent.parent
API_DIR = ROOT / "services" / "api"


def _prompt_url() -> str:
    env_url = os.environ.get("SUPABASE_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if env_url:
        return env_url.strip()
    print("Pega la cadena 'Session pooler' de Supabase.")
    print("Está en: Project Settings -> Database -> Connection string -> Session pooler.")
    return getpass.getpass("Cadena de conexión (no se mostrará): ").strip()


def _normalize_for_libpq(url: str) -> str:
    """Convierte la URL al formato que entiende psycopg2/Alembic."""
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://") :]
    url = url.replace("postgresql+asyncpg://", "postgresql://", 1)
    url = url.replace("postgresql+psycopg2://", "postgresql://", 1)

    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query))
    if "ssl" in query and "sslmode" not in query:
        query["sslmode"] = query.pop("ssl")
    query.setdefault("sslmode", "require")
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment)
    )


def _validate(url: str) -> None:
    if not url:
        raise SystemExit("No se recibió ninguna cadena de conexión.")
    if not url.startswith(("postgres://", "postgresql://", "postgresql+asyncpg://", "postgresql+psycopg2://")):
        raise SystemExit("La cadena debe empezar por postgresql:// (Session pooler de Supabase).")
    if "[YOUR-PASSWORD]" in url or "<password>" in url or "<ref>" in url:
        raise SystemExit("La cadena todavía contiene un marcador. Sustitúyalo por la contraseña real.")
    if ":6543" in url:
        print(
            "AVISO: está usando el Transaction pooler (6543). La API lo soporta, "
            "pero para migraciones y para el worker es más simple el Session pooler (5432).",
            file=sys.stderr,
        )


def _test_connection(url: str) -> None:
    try:
        import psycopg2
    except ImportError as exc:  # pragma: no cover
        raise SystemExit("Falta psycopg2-binary. Instale: pip install psycopg2-binary") from exc

    try:
        connection = psycopg2.connect(url, connect_timeout=20)
    except Exception as exc:
        raise SystemExit(
            "No fue posible conectar con Supabase.\n"
            f"Detalle: {exc}\n\n"
            "Revise:\n"
            "- que copió la cadena 'Session pooler' completa;\n"
            "- que la contraseña está URL-encoded (@ -> %40, : -> %3A, / -> %2F, # -> %23);\n"
            "- que el proyecto Supabase no esté pausado."
        ) from exc

    try:
        with connection.cursor() as cursor:
            cursor.execute("select current_database(), current_user, version()")
            database, user, version = cursor.fetchone()
            print(f"Conexión OK: db={database} usuario={user}")
            print(f"PostgreSQL: {version.split(',')[0]}")
    finally:
        connection.close()


def _run(command: list[str], env: dict[str, str]) -> None:
    print(f"\n> {' '.join(command)}")
    result = subprocess.run(command, cwd=API_DIR, env=env)
    if result.returncode != 0:
        raise SystemExit(f"El comando falló con código {result.returncode}.")


def _write_env(url: str) -> None:
    """Guarda la conexión en el .env de la raíz sin tocar otras claves."""
    env_path = ROOT / ".env"
    lines: list[str] = []
    if env_path.exists():
        lines = env_path.read_text(encoding="utf-8-sig").splitlines()

    updated = False
    for index, line in enumerate(lines):
        if line.strip().startswith("DATABASE_URL="):
            lines[index] = f"DATABASE_URL={url}"
            updated = True
            break
    if not updated:
        lines.append(f"DATABASE_URL={url}")

    existing = {
        line.split("=", 1)[0].strip()
        for line in lines
        if "=" in line and not line.lstrip().startswith("#")
    }
    defaults = {
        "ENVIRONMENT": "development",
        "QUEUE_BACKEND": "filesystem",
        "DATA_DIR": "data/uploads",
        "MODEL_DIR": "data/models",
        "TEMP_DIR": "data/tmp",
        "STORAGE_BACKEND": "local",
        "CORS_ORIGINS": "http://localhost:5173,http://127.0.0.1:5173",
    }
    for key, value in defaults.items():
        if key not in existing:
            lines.append(f"{key}={value}")

    env_path.write_text("\n".join(lines).strip() + "\n", encoding="utf-8")
    print(f"\nConfiguración guardada en {env_path} (ignorado por git).")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Configura Supabase Postgres para NeuroLab")
    parser.add_argument("--url", help="Cadena de conexión (mejor omitirla y usar el prompt)")
    parser.add_argument("--skip-seed", action="store_true", help="No crear el administrador inicial")
    parser.add_argument("--check-only", action="store_true", help="Solo probar la conexión")
    parser.add_argument(
        "--write-env",
        action="store_true",
        help="Guarda DATABASE_URL y la configuración local en el .env de la raíz",
    )
    args = parser.parse_args(argv)

    raw_url = (args.url or _prompt_url()).strip().strip('"').strip("'")
    _validate(raw_url)
    libpq_url = _normalize_for_libpq(raw_url)

    _test_connection(libpq_url)
    if args.check_only:
        if args.write_env:
            _write_env(raw_url)
        return 0

    env = os.environ.copy()
    env["DATABASE_URL"] = raw_url
    env["ENVIRONMENT"] = "development"

    _run([sys.executable, "-m", "alembic", "upgrade", "head"], env)
    _run([sys.executable, "-m", "alembic", "current"], env)

    if not args.skip_seed:
        _run([sys.executable, "-m", "app.cli", "seed-admin"], env)

    if args.write_env:
        _write_env(raw_url)

    print(
        "\nBase de datos preparada en Supabase.\n"
        "\nSi usó --write-env, el archivo .env de la raíz ya contiene la conexión."
        "\nArranque API y worker desde sus carpetas; ambos leen ese mismo .env:\n"
        "\n  cd services\\api; python -m uvicorn app.main:app --reload --port 8000\n"
        "  cd workers\\training; python worker.py\n"
        "\nSi no usó --write-env, defina DATABASE_URL en cada terminal."
        "\nEl frontend no cambia: http://localhost:5173\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
