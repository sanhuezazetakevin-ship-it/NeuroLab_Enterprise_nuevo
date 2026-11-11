# Despliegue cloud: Supabase + Vercel + Railway

Esta guía describe el despliegue del MVP con:

| Componente | Plataforma | Plan |
|---|---|---|
| Base de datos | Supabase Postgres | Free |
| CSV y artefactos `.keras` | Supabase Storage (S3) | Free, 1 GB |
| Frontend React | Vercel | Hobby / Free |
| API FastAPI | Railway | Free Trial ($5, 30 días) |
| Worker TensorFlow/Keras | Railway | Free Trial ($5, 30 días) |
| Cola y Pub/Sub | Railway Redis | Free Trial |

> **Advertencia de coste y recursos.** El plan Free Trial de Railway dura
> **30 días** e incluye **$5** de consumo. Cada servicio puede usar como máximo
> **1 vCPU / 1 GB de RAM**. TensorFlow cabe en 1 GB solo con modelos y lotes
> pequeños. Al terminar el trial, los servicios se suspenden o pasan a un plan
> pago. Render no se usa porque su plan gratuito **no permite background
> workers** y limita a 512 MB de RAM.

---

## 1. Arquitectura desplegada

```text
Navegador
   │  HTTPS
   ▼
Vercel (React/Vite) ─────► Railway API (FastAPI, 1 GB)
                                  │        │
                                  │        ├── Supabase Postgres (metadatos)
                                  │        └── Railway Redis (cola + eventos)
                                  │
                                  ├── Supabase Storage (artefactos, ficha, manifiesto)
                                  └── (opcional) TensorFlow para POST /predict
                                  ▼
                        Railway Worker (TensorFlow, 1 GB)
                                  │
                                  ├── descarga CSV de Supabase Storage
                                  └── sube model.keras, scaler.pkl, manifiesto y ficha
```

La API **no importa TensorFlow al arrancar**. El worker es un proceso separado
que consume la cola y actualiza el estado en PostgreSQL. API y worker no
comparten disco: por eso **Supabase Storage es obligatorio**, no opcional.
La única excepción a la regla de TensorFlow es el módulo de inferencia, que se
instala aparte y sólo se carga al usar `POST /predict`.

---

## 2. Supabase

### 2.1 Crear el proyecto

1. Cree un proyecto en <https://supabase.com/dashboard>.
2. Guarde la **contraseña de la base de datos**.
3. En **Project Settings → Database**, copie la cadena del **Session pooler**
   (puerto `5432`). Evite el Transaction pooler (`6543`) para el worker y para
   Alembic; la API lo soporta, pero el modo sesión es más simple.
4. Si la contraseña contiene caracteres especiales (`@`, `:`, `/`, `#`),
   codifíquela con URL encoding antes de pegarla.

`DATABASE_URL` debe quedar así:

```env
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
```

La API normaliza automáticamente `postgresql://` a `postgresql+asyncpg://` y
`sslmode=require` a `ssl=require` (asyncpg). El worker y Alembic hacen la
conversión inversa a `sslmode` para psycopg2. **No** cambie esos parámetros a
mano salvo que sepa qué driver los consume.

### 2.2 Migrar el esquema

Las migraciones se ejecutan automáticamente al arrancar el contenedor de la API
(`entrypoint.api.sh` → `alembic upgrade head`). Para hacerlo manualmente desde
su equipo:

```bash
cd services/api
export DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require"
alembic upgrade head
alembic current
```

### 2.3 Crear el bucket de Storage

1. Abra el **SQL Editor** de Supabase y ejecute
   [`infra/supabase/storage.sql`](../../infra/supabase/storage.sql).
2. Verifique en **Storage** que existe el bucket privado `neurolab`.
3. En **Project Settings → Storage → S3 access keys**, cree una clave.
4. Anote `Access key ID` y `Secret access key`. El secreto solo se muestra una
   vez.

Variables para API y worker:

```env
STORAGE_BACKEND=s3
S3_ENDPOINT_URL=https://<ref>.supabase.co/storage/v1/s3
S3_REGION=<region-del-proyecto>
S3_ACCESS_KEY_ID=<access-key-id>
S3_SECRET_ACCESS_KEY=<secret-access-key>
S3_BUCKET=neurolab
S3_FORCE_PATH_STYLE=true
```

La API sube los CSV a `datasets/<project>/<dataset>.csv` y el worker publica
`models/<project>/<job>/model.keras`, `scaler.pkl`, `preprocessor.pkl` y
`training_manifest.json`.

### 2.4 Probar en tu PC usando solo la base de datos de Supabase

Si quieres ejecutar la API, el worker y el frontend en tu equipo pero guardar
los metadatos en Supabase, no necesitas Storage todavía:

```powershell
cd C:\Users\sanhu\Desktop\NeuroLab_Enterprise
Copy-Item .env.local.example .env
python scripts/setup_supabase_db.py --write-env
```

El script pide la cadena **Session pooler** sin mostrarla por pantalla, prueba
la conexión, aplica `alembic upgrade head`, ejecuta el seed del administrador y
guarda `DATABASE_URL` en el `.env` de la raíz (ignorado por Git). La API y el
worker leen ese mismo archivo, así que no hay que repetir variables en cada
terminal. Usa `STORAGE_BACKEND=local` con `DATA_DIR`/`MODEL_DIR` en tu PC; al
desplegar en hosts distintos cambia a `STORAGE_BACKEND=s3`.

Para comprobar solo la conexión:

```powershell
python scripts/setup_supabase_db.py --check-only
```

---

## 3. Railway

### 3.1 Crear el proyecto y los servicios

1. Cree un proyecto en <https://railway.com> e importe el repositorio de GitHub.
2. **Servicio API**
   - Nombre: `neurolab-api`.
   - Settings → Build → Dockerfile Path:
     `infra/docker/Dockerfile.api`.
   - Settings → Networking → **Generate Domain**; puerto objetivo `8000`.
   - Healthcheck Path: `/health`, timeout `300`.
   - No configure un volumen: los archivos viven en Supabase Storage.
   - **Inferencia opcional:** añada la variable `INSTALL_INFERENCE=true` antes
     de construir. Railway la pasa como build-arg al `Dockerfile.api`, que
     instala TensorFlow y scikit-learn. Aumenta el tiempo de build y el consumo
     de RAM; sin ella, `/predict` responde `503` y el resto funciona igual.
3. **Servicio Worker**
   - Nombre: `neurolab-worker`.
   - Dockerfile Path: `infra/docker/Dockerfile.worker`.
   - Sin dominio público y sin healthcheck HTTP.
   - Restart policy: `ON_FAILURE` o `ALWAYS`.
4. **Redis**
   - New → Database → **Add Redis**.
   - No es necesario exponerlo públicamente; use la red privada.

Railway construye ambos servicios desde la **raíz del repositorio**; los
Dockerfiles ya copian las rutas del monorepo.

### 3.2 Variables de la API

| Variable | Valor |
|---|---|
| `ENVIRONMENT` | `production` |
| `SECRET_KEY` | cadena aleatoria de 32+ caracteres |
| `DATABASE_URL` | cadena de Supabase (sección 2.1) |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` |
| `QUEUE_BACKEND` | `redis` |
| `STORAGE_BACKEND` | `s3` |
| `S3_ENDPOINT_URL` | endpoint de Supabase Storage |
| `S3_REGION` | región del proyecto |
| `S3_ACCESS_KEY_ID` | clave S3 |
| `S3_SECRET_ACCESS_KEY` | secreto S3 |
| `S3_BUCKET` | `neurolab` |
| `S3_FORCE_PATH_STYLE` | `true` |
| `SEED_ADMIN_EMAIL` | correo del administrador |
| `SEED_ADMIN_PASSWORD` | contraseña inicial robusta |
| `SEED_ADMIN_NAME` | nombre visible |
| `CORS_ORIGINS` | `https://<frontend>.vercel.app` |
| `CORS_ORIGIN_REGEX` | `https://.*\.vercel\.app` |
| `DATA_DIR` | `/app/data/uploads` |
| `MODEL_DIR` | `/app/data/models` |
| `RUN_MIGRATIONS` | `true` |
| `SEED_ADMIN_ON_START` | `true` |
| `INFERENCE_REQUIRE_APPROVED` | `true` para servir sólo modelos `APPROVED` |
| `INSTALL_INFERENCE` | `true` sólo si usará `POST /predict` (build-arg) |

`REDIS_URL` con la sintaxis `${{Redis.REDIS_URL}}` es una **referencia de
variable de Railway**; se resuelve en la plataforma y no debe copiarse a un
`.env` local.

### 3.3 Variables del worker

Debe tener **las mismas** variables de base de datos, Redis, Storage y
`SECRET_KEY` que la API, además de:

| Variable | Valor |
|---|---|
| `QUEUE_BACKEND` | `redis` |
| `TF_CPP_MIN_LOG_LEVEL` | `2` |
| `QUEUE_POLL_SECONDS` | `2` |
| `TRAINING_TIMEOUT_SECONDS` | `1800` o menos en el trial |
| `MAX_UPLOAD_MB` | `50` |
| `DATA_DIR` | `/app/data/uploads` |
| `MODEL_DIR` | `/app/data/models` |
| `TEMP_DIR` | `/app/data/uploads/tmp` |

No copie `PORT` ni variables de Vercel al worker.

### 3.4 Primer arranque

El contenedor de la API ejecuta, en orden:

1. `alembic upgrade head`
2. `python -m app.cli seed-admin` (solo crea el admin si `users` está vacía)
3. `uvicorn` en `$PORT`

Revise **Deploy Logs** del servicio API. Debe aparecer la migración y el seed.
Si `SECRET_KEY` conserva el valor inseguro y `ENVIRONMENT=production`, la API
falla al arrancar: es intencional.

---

## 4. Vercel

1. En <https://vercel.com/new>, importe el mismo repositorio.
2. **Root Directory**: `apps/web`.
3. Framework Preset: **Vite**. Build: `npm run build`. Output: `dist`.
4. Variable de entorno (Production y Preview):

   ```env
   VITE_API_URL=https://<api>.up.railway.app/api/v1
   ```

5. Deploy.
6. Copie el dominio final (`https://<proyecto>.vercel.app`) y actualícelo en
   `CORS_ORIGINS` de Railway. Con `CORS_ORIGIN_REGEX` también se aceptan los
   dominios de preview de Vercel.

`apps/web/vercel.json` ya define el rewrite SPA y el cache de assets. **No**
use una URL relativa `/api/v1` en Vercel: no hay proxy Nginx en ese hosting.

---

## 5. Verificación E2E en producción

1. Abra el frontend de Vercel.
2. Inicie sesión con `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
3. Cree un proyecto.
4. Suba un CSV pequeño (por ejemplo 100–1.000 filas, 3–10 columnas).
5. Diseñe una red Feedforward pequeña (1–2 capas, 8–32 neuronas).
6. Inicie entrenamiento con `epochs` bajo (3–10) y `batch_size` 16–32.
7. Verifique en el monitor:
   - estado `QUEUED → PREPARING → RUNNING → COMPLETED`;
   - métricas por época sin recargar la página (SSE);
   - botón de cancelación antes de terminar.
8. Abra **Registro de modelos**, descargue el `.keras` y confirme el checksum.
9. Reinicie el servicio API en Railway y vuelva a descargar el modelo. Si la
   descarga sigue funcionando, Supabase Storage está bien configurado.
10. Abra **Ficha** y **Manifiesto**: confirme `schema_version 2`, las métricas
    ROC-AUC/PR-AUC y la comparación con baselines.
11. Si compiló con `INSTALL_INFERENCE=true`, use **Probar modelo**, envíe un
    registro y verifique que devuelve clase y probabilidad. Sin esa variable el
    panel mostrará un `503` explicativo, que es el comportamiento esperado.

Compruebe la salud de la API:

```bash
curl https://<api>.up.railway.app/health
```

---

## 6. Límites del plan temporal

- **30 días** de Free Trial y **$5** de crédito. API, worker y Redis consumen
  del mismo crédito.
- **1 GB de RAM por servicio**. TensorFlow puede agotarlo con datasets grandes
  o modelos profundos. Use CSV pequeños y redes mínimas. Si habilita inferencia
  en la API (`INSTALL_INFERENCE=true`), TensorFlow también consume RAM en ese
  servicio y la caché mantiene hasta 4 modelos cargados: en el trial conviene
  mantenerla desactivada o usar modelos muy pequeños.
- El worker se reinicia si falla; un entrenamiento en curso se marca `FAILED` y
  puede reprocesarse manualmente con `python worker.py --job-id <uuid>`.
- Supabase Free puede **pausar** el proyecto por inactividad. Restáurelo desde
  el dashboard antes de una demo.
- Supabase Storage Free incluye **1 GB**. Los CSV y artefactos `.keras` cuentan.
- Sin alta disponibilidad ni backups automáticos en los planes gratuitos.

Para una demo estable, mantenga el worker con un modelo pequeño y detenga los
servicios al terminar. Para producción real, migre a Railway Hobby (worker con
más RAM) o a un worker en Render con plan pago.

---

## 7. Diagnóstico rápido

| Síntoma | Causa probable | Solución |
|---|---|---|
| API 503 en `/health` | `DATABASE_URL` o SSL incorrectos | Use Session pooler 5432 y `sslmode=require` |
| `InvalidPasswordError` | contraseña sin URL-encode | Codifique `@ : / #` |
| `prepared statement` en Supabase | Transaction pooler 6543 | Use Session pooler 5432 o deje que la API añada `prepared_statement_cache_size=0` |
| CORS bloquea Vercel | `CORS_ORIGINS` desactualizado | Actualice el dominio y redepliegue |
| Dataset 404 al previsualizar | bucket/claves S3 mal configuradas | Revise `S3_*` y que el bucket sea `neurolab` |
| Worker no toma jobs | `REDIS_URL` distinto entre API y worker | Use la misma referencia `${{Redis.REDIS_URL}}` |
| `Killed` durante entrenamiento | RAM > 1 GB | Reduzca filas, capas, batch o features |
| `/predict` responde 503 | API sin dependencias de inferencia | Recompile con `INSTALL_INFERENCE=true` o instale `requirements-inference.txt` |
| `/predict` responde 409 | Modelo `RETIRED` o `INFERENCE_REQUIRE_APPROVED=true` sin aprobar | Apruebe el modelo o ajuste la política |
| Modelo 404 tras reinicio | `STORAGE_BACKEND=local` | Cambie a `s3` con Supabase Storage |

---

## 8. Alternativa: Render

Render solo permite **web services** en el plan gratuito y limita a **512 MB**.
El worker de TensorFlow y un Redis externo no caben de forma fiable. Si se
quiere usar Render, el worker debe ir en un plan pago (`0.5c-512mb` o superior)
o en otra plataforma. La API sí puede desplegarse en Render con el mismo
`Dockerfile.api`, usando Supabase para base de datos y Storage, y un Redis
público (por ejemplo Upstash) para la cola.
