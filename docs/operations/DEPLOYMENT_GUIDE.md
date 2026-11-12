# Guía de despliegue y operación

## 1. Requisitos

| Entorno | Requisitos |
|---|---|
| Docker | Docker Engine 24+ y Docker Compose v2 |
| Local API | Python 3.11+ (probado con 3.13), pip |
| Local worker | Python 3.11+, TensorFlow 2.x |
| Local web | Node.js 20+, npm |
| Producción | PostgreSQL 16, Redis 7, almacenamiento compartido para `DATA_DIR` y `MODEL_DIR` |

---

## 2. Variables de entorno

Copie `.env.example` a `.env` y ajuste los valores.

| Variable | Por defecto | Descripción |
|---|---|---|
| `ENVIRONMENT` | `development` | `production` desactiva `create_all`; el seed se ejecuta desde el entrypoint |
| `LOG_LEVEL` | `INFO` | Nivel de logging |
| `SECRET_KEY` | valor inseguro | **Obligatorio cambiarlo**; en producción se rechaza el valor por defecto |
| `ALGORITHM` | `HS256` | Algoritmo JWT |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `480` | Vigencia del token |
| `LOGIN_RATE_LIMIT_PER_MINUTE` | `10` | Intentos de login por IP y minuto |
| `SEED_ADMIN_*` | admin / contraseña generada | Sólo se aplica si `users` está vacía; defina `SEED_ADMIN_PASSWORD` en producción |
| `DATABASE_URL` | PostgreSQL local | URL async (`postgresql+asyncpg://…` o `sqlite+aiosqlite:///…`) |
| `REDIS_URL` | `redis://localhost:6379/0` | Conexión Redis |
| `QUEUE_BACKEND` | `redis` | `redis` o `filesystem` |
| `TRAINING_QUEUE` | `neurolab:training:queue` | Nombre de la cola |
| `QUEUE_POLL_SECONDS` | `2` | Espera del worker sin trabajos |
| `DATA_DIR` | `services/api/data/uploads` | CSV, cola y flags (API y worker deben compartirlo) |
| `MODEL_DIR` | `services/api/data/models` | Artefactos `.keras`, scaler, manifiesto y ficha |
| `MAX_UPLOAD_MB` | `50` | Tamaño máximo de CSV |
| `MAX_CSV_ROWS` | `500000` | Filas máximas |
| `MAX_CSV_COLUMNS` | `500` | Columnas máximas |
| `MAX_FEATURES_AFTER_ENCODING` | `5000` | Límite del worker tras one-hot |
| `TRAINING_TIMEOUT_SECONDS` | `7200` | Timeout de entrenamiento |
| `STORAGE_BACKEND` | `local` | `local` o `s3` (Supabase Storage, MinIO, S3, R2) |
| `S3_*` | vacío | Endpoint, región, claves y bucket cuando `STORAGE_BACKEND=s3` |
| `INFERENCE_REQUIRE_APPROVED` | `false` | `true` sirve sólo modelos `APPROVED` en `/predict` |
| `INSTALL_INFERENCE` | `false` | Build-arg de Docker: instala TensorFlow/sklearn en la API |
| `CORS_ORIGINS` | `http://localhost:5173,…` | Orígenes permitidos si no se usa el proxy Nginx |
| `CORS_ORIGIN_REGEX` | vacío | Regex para dominios de preview (por ejemplo Vercel) |
| `VITE_API_URL` | `/api/v1` (Docker) | URL de API compilada en el frontend |

---

## 3. Docker Compose

### 3.1 Arranque

```bash
cp .env.example .env
# Edite .env: SECRET_KEY, contraseñas y entorno
docker compose up -d --build
docker compose ps
```

Para habilitar la inferencia en la API, defina `INSTALL_INFERENCE=true` en
`.env` antes del build (o ejecute
`INSTALL_INFERENCE=true docker compose up -d --build api`). Esto instala
TensorFlow y scikit-learn en el contenedor de la API y aumenta su consumo de
memoria. Sin esa variable, `/predict` responde `503`.

Servicios y puertos:

| Servicio | Puerto | Notas |
|---|---|---|
| `web` | `5173:80` | Nginx + build React; proxy `/api/` |
| `api` | `8000:8000` | FastAPI |
| `worker` | — | Worker TensorFlow/Keras |
| `postgres` | `5432:5432` | Volumen `pgdata` |
| `redis` | `6379:6379` | Volumen `redisdata` |

Volúmenes nombrados: `pgdata`, `redisdata`, `uploads`, `models`.
`api` y `worker` montan `uploads` en `/data/uploads` y `models` en `/data/models`. **No cambie uno sin el otro**: el worker no encontraría los CSV y la API no podría descargar los modelos.

### 3.2 Healthchecks

```bash
curl -fsS http://localhost:8000/health
docker compose ps
```

- PostgreSQL: `pg_isready`.
- Redis: `redis-cli ping`.
- API: `GET /health` (200 si la base de datos responde).
- `worker` y `web` dependen de que la API esté healthy.

### 3.3 Logs

```bash
docker compose logs -f api
docker compose logs -f worker
docker compose logs -f web
```

### 3.4 Detener y limpiar

```bash
docker compose down            # conserva volúmenes
docker compose down -v         # elimina datos (¡destructivo!)
```

### 3.5 Escalar workers

`docker-compose.yml` fija `container_name`, lo que impide escalar. Para ejecutar más de un worker:

1. Elimine `container_name: neurolab_worker`.
2. Ejecute `docker compose up -d --scale worker=2`.
3. Verifique que `DATA_DIR` y `MODEL_DIR` estén en almacenamiento compartido y que Redis sea accesible por todos.

Los workers compiten por `BLPOP`; cada job lo procesa exactamente uno.

---

## 4. Producción

### 4.1 Esquema con Alembic

Con `ENVIRONMENT=production` la API no crea tablas ni usuarios. El entrypoint
del contenedor aplica las migraciones automáticamente:

```bash
docker compose up -d
docker compose logs -f api   # debe mostrar "Aplicando migraciones Alembic..."
```

También puede ejecutarlas manualmente:

```bash
docker compose run --rm api alembic upgrade head
docker compose run --rm api alembic current
```

Para verificar que los modelos ORM no tienen cambios sin migrar:

```bash
docker compose run --rm api alembic check
```

### 4.2 Primer administrador

El entrypoint ejecuta `python -m app.cli seed-admin`, que crea el usuario
`SEED_ADMIN_EMAIL` **solo si la tabla `users` está vacía**. No restablece
contraseñas existentes. En producción, defina `SEED_ADMIN_PASSWORD` con una
clave robusta antes del primer arranque; después cambie la contraseña desde
`POST /api/v1/auth/change-password`.

Para ejecutarlo manualmente:

```bash
docker compose run --rm api python -m app.cli seed-admin
```

### 4.3 Checklist de seguridad

- [ ] `SECRET_KEY` robusta y secreta.
- [ ] `ENVIRONMENT=production`.
- [ ] Contraseña de PostgreSQL distinta de la de ejemplo.
- [ ] Redis sin exposición pública (sin puerto publicado o con autenticación).
- [ ] TLS terminado en un proxy delante de `web`/`api`.
- [ ] `CORS_ORIGINS` limitado a dominios reales.
- [ ] Volúmenes con permisos restringidos y backups cifrados.
- [ ] Rate limit de login movido a Redis si hay varias réplicas.
- [ ] Rotación de logs y monitoreo de `GET /health` / `/api/v1/admin/system`.

### 4.4 Despliegue cloud gestionado

Para publicar el frontend en Vercel, la API y el worker en Railway, y usar
Supabase como base de datos y almacenamiento de objetos, siga
[`DEPLOY_SUPABASE_VERCEL_RAILWAY.md`](DEPLOY_SUPABASE_VERCEL_RAILWAY.md). Esa
guía incluye migraciones, seed, bucket S3, CORS, verificación E2E y los límites
del plan gratuito/temporal.

---

## 5. Desarrollo local sin Docker

### 5.1 API

```bash
cd services/api
python -m venv .venv
# Windows: .venv\Scripts\activate
# Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
```

Cree `services/api/.env` (la API lee `.env` desde su directorio de trabajo) o exporte variables.

**Con PostgreSQL y Redis:**

```env
DATABASE_URL=postgresql+asyncpg://neurolab:neurolab_secure_pass@localhost:5432/neurolab_db
REDIS_URL=redis://localhost:6379/0
QUEUE_BACKEND=redis
```

**Sin infraestructura:**

```env
DATABASE_URL=sqlite+aiosqlite:///./neurolab_dev.db
QUEUE_BACKEND=filesystem
DATA_DIR=./data/uploads
MODEL_DIR=./data/models
```

Arranque:

```bash
uvicorn app.main:app --reload --port 8000
```

En desarrollo se crea el esquema y el admin inicial si no hay usuarios.

### 5.2 Worker

```bash
cd workers/training
python -m venv .venv
# Activar entorno
pip install -r requirements.txt
```

El worker lee el `.env` de la raíz y, como respaldo, `services/api/.env`. También acepta variables de entorno.

```bash
# Cola en disco
export QUEUE_BACKEND=filesystem        # Windows PowerShell: $env:QUEUE_BACKEND="filesystem"
export DATABASE_URL=sqlite+aiosqlite:///../../services/api/neurolab_dev.db
export DATA_DIR=../../services/api/data/uploads
export MODEL_DIR=../../services/api/data/models

python worker.py
```

Modos:

```bash
python worker.py                 # daemon
python worker.py --once          # un trabajo y sale
python worker.py --job-id <uuid> # reconstruye el payload desde la BD
python worker.py --payload <json>
```

El worker convierte automáticamente:

- `postgresql+asyncpg://` → `postgresql+psycopg2://`
- `sqlite+aiosqlite:///` → `sqlite:///`

Las rutas relativas de `DATA_DIR`/`MODEL_DIR` se resuelven contra `services/api`; mantenga la misma resolución que la API.

### 5.3 Frontend

```bash
cd apps/web
npm install
npm run dev
```

`VITE_API_URL` por defecto es `http://localhost:8000/api/v1`. Para cambiarlo, cree `apps/web/.env.local`:

```env
VITE_API_URL=http://localhost:8000/api/v1
```

Build de producción:

```bash
npm run build   # tsc + vite build → apps/web/dist
```

---

## 6. Backend de cola

### Redis (recomendado)

- Cola: `RPUSH` / `BLPOP` sobre `TRAINING_QUEUE`.
- Eventos: `neurolab:job:{job_id}:events`.
- Cancelación: `neurolab:job:{job_id}:cancel` + publicación de control.

Verificación:

```bash
redis-cli ping
redis-cli llen neurolab:training:queue
redis-cli subscribe neurolab:job:<job_id>:events
```

### Filesystem (desarrollo)

- Descriptor: `DATA_DIR/queue/<timestamp>-<job_id>.json`.
- En procesamiento: `DATA_DIR/queue/processing/`.
- Cancelación: `DATA_DIR/cancellations/<job_id>.flag`.
- Los jobs interrumpidos en `processing/` se devuelven a la cola al arrancar el worker.

No use `filesystem` con varios hosts: el directorio debe ser local al worker o estar en un volumen compartido con bloqueo fiable.

---

## 7. Respaldos y restauración

### Base de datos

```bash
docker compose exec -T postgres pg_dump -U neurolab -Fc neurolab_db > neurolab_$(date +%F).dump
```

Restauración:

```bash
docker compose exec -T postgres pg_restore -U neurolab -d neurolab_db --clean --if-exists < neurolab_2026-11-01.dump
```

### Artefactos y datasets

Respalde los volúmenes `uploads` y `models` de forma consistente con la base de datos:

```bash
docker run --rm -v neurolab_enterprise_uploads:/data -v "$PWD":/backup alpine \
  tar czf /backup/uploads_$(date +%F).tar.gz -C /data .
docker run --rm -v neurolab_enterprise_models:/data -v "$PWD":/backup alpine \
  tar czf /backup/models_$(date +%F).tar.gz -C /data .
```

Ajuste el nombre del volumen al prefijo real del proyecto Compose. Restaure base de datos y volúmenes del mismo punto temporal: los `storage_key` y checksums deben coincidir.

### Retención

- Los modelos `RETIRED` se conservan por trazabilidad.
- No hay borrado automático de artefactos. Defina una política externa para proyectos eliminados.
- La auditoría no se depura desde la aplicación.

---

## 8. Operación diaria

| Tarea | Procedimiento |
|---|---|
| Crear usuario | `POST /api/v1/admin/users` (ADMIN) |
| Cambiar rol o estado | `PATCH /api/v1/admin/users/{id}` |
| Desactivar cuenta | `status=INACTIVE` o `SUSPENDED`; el token deja de ser válido en el siguiente request |
| Cambiar contraseña | `POST /api/v1/auth/change-password` (usuario autenticado) |
| Revisar estado | `GET /api/v1/admin/system` |
| Revisar auditoría | `GET /api/v1/projects/{id}/audit-events` |
| Reintentar un job | `python worker.py --job-id <uuid>` con el worker detenido o usando una instancia dedicada |
| Cancelar un job | `POST /api/v1/training-jobs/{id}/cancel` |

No existe endpoint de reset de contraseña por administrador en el MVP. Si un usuario pierde el acceso, un operador debe actualizar `password_hash` con bcrypt o recrear la cuenta.

---

## 9. Diagnóstico de problemas

| Síntoma | Causa probable | Acción |
|---|---|---|
| `503` al lanzar entrenamiento | Redis no disponible | Verifique `REDIS_URL`, `docker compose ps`, `redis-cli ping` |
| Job en `QUEUED` indefinidamente | Worker no corre o apunta a otra cola/BD | Revise logs del worker, `QUEUE_BACKEND`, `TRAINING_QUEUE`, `DATABASE_URL` |
| `El archivo del dataset no existe` | `DATA_DIR` distinto entre API y worker | Unifique el volumen/ruta |
| `La forma de entrada no coincide` | `input_shape` distinto de las features del CSV | Ajuste la arquitectura con el preview del dataset |
| `422` al entrenar GAN | Familia generativa no habilitada | Use FEEDFORWARD, RNN o CNN; GAN es conceptual en el MVP |
| `422` con `Conv2D`/`MaxPooling2D` en CNN | Capas 2D no aplican a datos tabulares | Cambie a `Conv1D`/`MaxPooling1D` |
| Modelo sin descarga (`404`) | Artefacto no está en el nodo o `MODEL_DIR` distinto | Verifique el volumen y la ruta `storage_key` |
| SSE se corta tras el proxy | Buffering o timeout | Confirme `proxy_buffering off` y timeouts largos en Nginx |
| Login `429` | Rate limit por IP | Espere un minuto o ajuste `LOGIN_RATE_LIMIT_PER_MINUTE` |
| `SECRET_KEY insegura` al arrancar | `ENVIRONMENT=production` con clave por defecto | Configure una clave robusta |
| `alembic check` reporta diferencias | Modelos ORM cambiaron sin migración | Genere y aplique una revisión |

---

## 10. Actualización de versión

1. Respalde PostgreSQL y los volúmenes.
2. Revise nuevas variables en `.env.example`.
3. Reconstruya imágenes: `docker compose build`.
4. Aplique migraciones: `docker compose run --rm api alembic upgrade head`.
5. Levante servicios: `docker compose up -d`.
6. Verifique `/health`, `/api/v1/admin/system` y un entrenamiento corto.
7. Confirme que el worker procesa jobs y que la UI recibe telemetría.
