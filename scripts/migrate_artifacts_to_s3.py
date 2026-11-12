"""Copia los artefactos locales (datasets y modelos) al bucket S3 configurado.

La base de datos guarda claves como ``datasets/<proyecto>/<id>.csv`` o
``models/<proyecto>/<id>/modelo.keras``. En local esos archivos viven en
``DATA_DIR`` y ``MODEL_DIR``; en Railway (disco efímero) deben estar en
Supabase Storage para que la API y el worker los encuentren.

Uso (desde la raíz del repositorio):

    python scripts/migrate_artifacts_to_s3.py             # simulación
    python scripts/migrate_artifacts_to_s3.py --apply     # sube de verdad
    python scripts/migrate_artifacts_to_s3.py --apply --overwrite

Requiere ``boto3`` y las variables ``S3_ENDPOINT_URL``, ``S3_REGION``,
``S3_ACCESS_KEY_ID``, ``S3_SECRET_ACCESS_KEY`` y ``S3_BUCKET`` en el entorno o
en ``.env``. Por defecto no sobrescribe objetos existentes en el bucket.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
API_DIR = REPO_ROOT / "services" / "api"

CONTENT_TYPES = {
    ".csv": "text/csv",
    ".json": "application/json",
    ".jsonl": "application/x-ndjson",
    ".keras": "application/octet-stream",
    ".h5": "application/octet-stream",
    ".pkl": "application/octet-stream",
    ".joblib": "application/octet-stream",
    ".bin": "application/octet-stream",
}


def load_env() -> None:
    """Carga .env sin depender de la configuración de la API."""
    env_file = REPO_ROOT / ".env"
    if not env_file.exists():
        return
    try:
        from dotenv import load_dotenv
    except ImportError:  # pragma: no cover - ruta sin python-dotenv
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())
        return
    load_dotenv(env_file, override=False)


def resolve_dir(value: str | None, default: Path) -> Path:
    """Resuelve rutas relativas igual que el arranque local (contra services/api)."""
    if not value:
        return default
    path = Path(value)
    if not path.is_absolute():
        path = (API_DIR / path).resolve()
    return path


def collect(base: Path, prefix: str) -> list[tuple[str, Path]]:
    """Devuelve pares (clave S3, archivo local) para un prefijo permitido."""
    root = base / prefix
    if not root.is_dir():
        return []
    return [
        (f"{prefix}/{path.relative_to(root).as_posix()}", path)
        for path in sorted(root.rglob("*"))
        if path.is_file()
    ]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Sube los archivos. Sin esta opción solo muestra qué haría.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Vuelve a subir objetos que ya existen en el bucket.",
    )
    args = parser.parse_args(argv)

    load_env()
    data_dir = resolve_dir(os.getenv("DATA_DIR"), API_DIR / "data" / "uploads")
    model_dir = resolve_dir(os.getenv("MODEL_DIR"), API_DIR / "data" / "models")

    items = collect(data_dir, "datasets") + collect(model_dir, "models")
    if not items:
        print(f"No hay artefactos en {data_dir} ni en {model_dir}.")
        return 0

    print(f"Artefactos locales: {len(items)}")
    for key, path in items:
        print(f"  {key}  ({path.stat().st_size:,} bytes)")

    missing = [
        name
        for name, value in (
            ("S3_ENDPOINT_URL", os.getenv("S3_ENDPOINT_URL")),
            ("S3_ACCESS_KEY_ID", os.getenv("S3_ACCESS_KEY_ID")),
            ("S3_SECRET_ACCESS_KEY", os.getenv("S3_SECRET_ACCESS_KEY")),
            ("S3_BUCKET", os.getenv("S3_BUCKET")),
        )
        if not value
    ]
    if not args.apply:
        if missing:
            print("\nFaltan variables para subir: " + ", ".join(missing))
        print("\nSimulación: no se subió nada. Use --apply para copiar al bucket.")
        return 0
    if missing:
        print("\nERROR: faltan variables: " + ", ".join(missing), file=sys.stderr)
        return 2

    try:
        import boto3
        from botocore.config import Config
        from botocore.exceptions import ClientError
    except ImportError:
        print("ERROR: boto3 no está instalado (pip install boto3).", file=sys.stderr)
        return 2

    client = boto3.client(
        "s3",
        endpoint_url=os.environ["S3_ENDPOINT_URL"],
        region_name=os.getenv("S3_REGION") or "us-east-1",
        aws_access_key_id=os.environ["S3_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["S3_SECRET_ACCESS_KEY"],
        config=Config(
            signature_version="s3v4",
            s3={
                "addressing_style": (
                    "path"
                    if os.getenv("S3_FORCE_PATH_STYLE", "true").lower()
                    in {"1", "true", "yes", "on"}
                    else "auto"
                )
            },
        ),
    )
    bucket = os.environ["S3_BUCKET"]

    uploaded = skipped = failed = 0
    for key, path in items:
        if not args.overwrite:
            try:
                client.head_object(Bucket=bucket, Key=key)
                print(f"  = {key} (ya existe)")
                skipped += 1
                continue
            except ClientError:
                pass
        try:
            client.upload_file(
                str(path),
                bucket,
                key,
                ExtraArgs={
                    "ContentType": CONTENT_TYPES.get(
                        path.suffix.lower(), "application/octet-stream"
                    )
                },
            )
            print(f"  + {key}")
            uploaded += 1
        except Exception as exc:  # noqa: BLE001 - se informa y se continúa
            print(f"  ! {key}: {exc}", file=sys.stderr)
            failed += 1

    print(
        f"\nSubidos: {uploaded} · omitidos: {skipped} · fallidos: {failed}"
    )
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
