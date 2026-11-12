#!/bin/sh
set -eu

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] Aplicando migraciones Alembic..."
  alembic upgrade head
fi

if [ "${SEED_ADMIN_ON_START:-true}" = "true" ]; then
  echo "[entrypoint] Verificando administrador inicial..."
  python -m app.cli seed-admin
fi

exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-8000}" \
  --proxy-headers \
  --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-127.0.0.1}"
