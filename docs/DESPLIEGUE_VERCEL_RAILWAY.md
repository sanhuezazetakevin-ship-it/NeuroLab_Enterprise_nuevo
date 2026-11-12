# Despliegue: Supabase + Railway (API y worker) + Vercel (web)

Esta guía deja NeuroLab Enterprise en producción usando:

| Pieza | Servicio | Qué ejecuta |
|---|---|---|
| Base de datos | **Supabase** (PostgreSQL) | Esquema, usuarios, proyectos, datasets, jobs, métricas |
| Artefactos | **Supabase Storage** (S3) | CSV, modelos `.keras`, preprocesadores, manifiestos |
| API | **Railway** | `services/api` (FastAPI + Alembic) |
| Worker | **Railway** | `workers/training` (TensorFlow/Keras) |
| Cola | **Railway Redis** | Trabajos de entrenamiento |
| Frontend | **Vercel** | `apps/web` (Vite + React) |

> El disco de Railway es efímero y no se comparte entre servicios. Por eso los
> artefactos **deben** ir a Supabase Storage. Si dejas `STORAGE_BACKEND=local`,
> el entrenamiento funciona pero los CSV/modelos se pierden al redeploy.

---

## 0. Requisitos

- Repositorio en GitHub (Railway y Vercel despliegan desde el repo).
- Proyecto de Supabase ya creado (el mismo que usa la app local).
- Cuenta en Railway y en Vercel.
- La app local funcionando (ver `docs/ARRANQUE_LOCAL.md`).

Railway y Vercel construyen desde **GitHub**, no desde tu disco. Antes de
importar el repositorio, sube los cambios:

```powershell
git status
git add -A
git commit -m "Flujo guiado, Supabase y configuración de despliegue"
git push origin mejoras_al_sistema
```

> Revisa `git status` antes de `git add -A`: si tienes archivos que no quieres
> publicar (pruebas, capturas, datos), añádelos a `.gitignore` o sácalos del
> commit.

---

## 1. Supabase

### 1.1 Cadena de conexión

1. Supabase → **Project Settings → Database → Connection string → Session pooler**.
2. Copia la URL (puerto **5432**, no 6543) y conserva `?sslmode=require`.

```text
postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
```

Si la contraseña tiene caracteres especiales, codifícala con URL (`@` → `%40`, etc.).

### 1.2 Bucket de artefactos

1. Supabase → **SQL Editor** → ejecuta el contenido de `infra/supabase/storage.sql`.
   Crea el bucket privado `neurolab`.
2. Supabase → **Storage → S3 access keys** → crea una clave.
3. Anota:
   - `S3_ENDPOINT_URL` = `https://<ref>.supabase.co/storage/v1/s3`
   - `S3_REGION` = región del proyecto (por ejemplo `us-east-1`)
   - `S3_ACCESS_KEY_ID`
   - `S3_SECRET_ACCESS_KEY`

### 1.3 Artefactos que ya existen en local

Los datasets y modelos entrenados en local están en `services/api/data/...`,
mientras que Supabase solo guarda sus claves (`datasets/...`, `models/...`). Al
pasar a `STORAGE_BACKEND=s3` esos archivos no existen en el bucket y las
descargas, evaluaciones o predicciones fallarían.

Cópialos una vez, después de crear las claves S3:

```powershell
python scripts/migrate_artifacts_to_s3.py            # simulación
python scripts/migrate_artifacts_to_s3.py --apply    # sube datasets y modelos
```

El script no sobrescribe objetos existentes salvo que uses `--overwrite`. Los
datasets nuevos que subas desde la app en producción ya van directo al bucket.

### 1.4 Esquema

El servicio de API aplica `alembic upgrade head` al arrancar
(`RUN_MIGRATIONS=true` por defecto). No hace falta migrar a mano.

> Los datos que ya existen en Supabase se conservan. El despliegue no borra ni
> siembra proyectos, datasets ni modelos.

---

## 2. Railway: Redis, API y worker

### 2.1 Crear el proyecto y Redis

1. Railway → **New Project → Deploy from GitHub repo**.
2. En el mismo proyecto: **New → Database → Redis**.
3. Railway expone `REDIS_URL` como variable del servicio Redis.

### 2.2 Servicio API

1. **New → GitHub Repo** (el mismo repositorio).
2. En el servicio → **Settings → Config-as-code → Config Path**:
   `/railway.api.json`
3. **Settings → Networking → Generate Domain** para obtener la URL pública,
   por ejemplo `https://neurolab-api.up.railway.app`.
4. Variables de entorno (pestaña **Variables**):

```text
ENVIRONMENT=production
LOG_LEVEL=INFO
SQL_ECHO=false
SECRET_KEY=<clave-aleatoria-de-32-o-mas-caracteres>
ACCESS_TOKEN_EXPIRE_MINUTES=480

DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require

REDIS_URL=${{Redis.REDIS_URL}}
QUEUE_BACKEND=redis
TRAINING_QUEUE=neurolab:training:queue
QUEUE_POLL_SECONDS=2

STORAGE_BACKEND=s3
S3_ENDPOINT_URL=https://<ref>.supabase.co/storage/v1/s3
S3_REGION=<region>
S3_ACCESS_KEY_ID=<access-key>
S3_SECRET_ACCESS_KEY=<secret-key>
S3_BUCKET=neurolab
S3_FORCE_PATH_STYLE=true

DATA_DIR=/data/uploads
MODEL_DIR=/data/models
MAX_UPLOAD_MB=50
MAX_CSV_ROWS=500000
MAX_CSV_COLUMNS=500

CORS_ORIGINS=https://<tu-app>.vercel.app
CORS_ORIGIN_REGEX=

# Detrás del proxy de Railway, la IP real llega en X-Forwarded-For. Se confía
# en esa cabecera solo cuando la conexión viene de la red interna (RFC1918 /
# CGNAT), para que el límite de login no agrupe a todos los usuarios.
TRUSTED_PROXY_IPS=127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,100.64.0.0/10
LOGIN_RATE_LIMIT_PER_MINUTE=60

RUN_MIGRATIONS=true
SEED_ADMIN_ON_START=true
SEED_ADMIN_EMAIL=admin@neurolab.enterprise
SEED_ADMIN_PASSWORD=<contraseña-inicial-robusta>
SEED_ADMIN_NAME=Administrador NeuroLab
```

Notas:

- `PORT` lo inyecta Railway; el entrypoint y el `HEALTHCHECK` del Dockerfile ya
  lo usan.
- Con `ENVIRONMENT=production`, la API **exige** `SECRET_KEY` de 32+ caracteres
  y `SEED_ADMIN_PASSWORD` de 12+ caracteres, aunque el administrador ya exista.
- `SEED_ADMIN_*` solo crea el admin si `public.users` está vacía. Si ya existe
  tu usuario en Supabase, **no cambia su contraseña**: seguirás entrando con la
  que tengas. Para cambiarla, usa **Administración** en la app o el CLI.
- Para generar `SECRET_KEY`:
  `python -c "import secrets; print(secrets.token_urlsafe(48))"`
- Si ves bloqueos de login inesperados, revisa `TRUSTED_PROXY_IPS` y
  `LOGIN_RATE_LIMIT_PER_MINUTE` (ver el bloque de arriba).

### 2.3 Servicio worker

1. **New → GitHub Repo** (el mismo repositorio).
2. **Settings → Config-as-code → Config Path**: `/railway.worker.json`
3. Variables de entorno: **las mismas que la API**, excepto las de API:

```text
ENVIRONMENT=production
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
REDIS_URL=${{Redis.REDIS_URL}}
QUEUE_BACKEND=redis
TRAINING_QUEUE=neurolab:training:queue
QUEUE_POLL_SECONDS=2
WORKER_HEARTBEAT_TIMEOUT_SECONDS=900

STORAGE_BACKEND=s3
S3_ENDPOINT_URL=https://<ref>.supabase.co/storage/v1/s3
S3_REGION=<region>
S3_ACCESS_KEY_ID=<access-key>
S3_SECRET_ACCESS_KEY=<secret-key>
S3_BUCKET=neurolab
S3_FORCE_PATH_STYLE=true

DATA_DIR=/data/uploads
MODEL_DIR=/data/models
TF_CPP_MIN_LOG_LEVEL=2
```

No expongas dominio público al worker: no atiende HTTP.

### 2.4 Verificar la API

```powershell
Invoke-RestMethod https://<api>.up.railway.app/health | ConvertTo-Json
```

Debe responder `status: healthy`, `database: up`, `environment: production`.

Swagger: `https://<api>.up.railway.app/api/v1/docs`

---

## 3. Vercel: frontend

1. Vercel → **Add New → Project** → importa el repositorio.
2. **Root Directory**: `apps/web`
3. Framework preset: **Vite** (lo detecta solo).
4. Build Command: `npm run build`
5. Output Directory: `dist`
6. Variable de entorno (**Production** y **Preview**):

```text
VITE_API_URL=https://<api>.up.railway.app/api/v1
```

7. **Deploy**.
8. Copia el dominio final (por ejemplo `https://neurolab.vercel.app`).

`VITE_API_URL` se incrusta en el build: si cambia la URL de la API, hay que
volver a desplegar el frontend.

`apps/web/vercel.json` ya incluye:

- reescritura SPA (`/(.*)` → `/index.html`),
- caché inmutable para `/assets/*`.

### 3.1 Cerrar CORS

1. Vuelve a Railway → servicio API → `CORS_ORIGINS`.
2. Pon el dominio exacto de producción:

```text
CORS_ORIGINS=https://<tu-app>.vercel.app
```

3. Redeploy del servicio API.

Solo si necesitas probar previews de Vercel (URLs aleatorias), añade
`CORS_ORIGIN_REGEX=https://.*\.vercel\.app` y retíralo cuando termines.

---

## 4. Prueba de humo en producción

1. Abre la web de Vercel e inicia sesión con el admin.
2. Comprueba que aparecen tus proyectos reales de Supabase.
3. Crea un proyecto:
   - Debe redirigir automáticamente a **Conjuntos de datos** con el modal de
     carga abierto.
4. Sube un CSV e indica la columna objetivo.
   - Al registrarse, debe abrir **Diseñador de redes** con ese dataset
     seleccionado.
5. Guarda la arquitectura.
   - Debe abrir **Entrenamientos** con arquitectura y dataset preseleccionados.
6. Inicia el entrenamiento y confirma que el estado pasa de `QUEUED` a
   `RUNNING` y avanza la telemetría.
7. Al terminar, revisa **Evaluación y métricas** y **Registro de modelos**.

Si el job se queda en `QUEUED`, el worker no está consumiendo: revisa sus logs
en Railway y que `REDIS_URL` y `QUEUE_BACKEND=redis` coincidan en API y worker.

---

## 5. Problemas comunes

| Síntoma | Causa probable | Solución |
|---|---|---|
| Web carga pero las peticiones fallan | `VITE_API_URL` incorrecta o CORS | Revisa la variable y `CORS_ORIGINS`; redeploy |
| `502` en la API | Contenedor sin arrancar o migraciones fallando | Logs del servicio en Railway |
| `database: down` en `/health` | `DATABASE_URL` mal o pooler 6543 | Usa Session pooler 5432 + `sslmode=require` |
| Job eterno en `QUEUED` | Worker caído o Redis distinto | Revisa logs del worker y `REDIS_URL` |
| `403` al subir/descargar artefactos | Claves S3 o bucket | Revisa `S3_*` y ejecuta `infra/supabase/storage.sql` |
| Modelos desaparecen tras un redeploy | `STORAGE_BACKEND=local` | Cambia a `s3` y vuelve a entrenar |
| Datasets/modelos antiguos dan error en producción | Sus archivos solo están en el disco local | Ejecuta `scripts/migrate_artifacts_to_s3.py --apply` |
| Login bloqueado al rato | Límite por IP detrás del proxy | Ajusta `LOGIN_RATE_LIMIT_PER_MINUTE` / `TRUSTED_PROXY_IPS` |

---

## 6. Costes y límites a tener en cuenta

- **Worker**: TensorFlow consume RAM. Usa al menos 2 GB en Railway; si el
  contenedor reinicia por OOM, sube el plan del servicio.
- **Supabase**: el plan gratuito pausa proyectos inactivos. Para uso continuo,
  usa un plan que no pause o programa actividad.
- **Vercel**: el frontend es estático; no necesita funciones serverless ni
  variables secretas.
- **Storage**: el bucket privado no requiere políticas públicas; API y worker
  acceden con las claves S3.

---

## 7. Qué NO hay que hacer

- No subas `.env` al repositorio: usa las variables de Railway y Vercel.
- No uses el pooler de transacciones (`6543`) con este código.
- No uses `STORAGE_BACKEND=local` en Railway si esperas conservar artefactos.
- No borres el bucket ni las tablas de Supabase para "limpiar": la app no
  siembra datos de demostración.
