# Arranque local real (sin demo)

Esta es la forma de arrancar NeuroLab Enterprise en este equipo para probarlo
con una base propia y datos reales. **No se siembran proyectos, datasets ni
entrenamientos de demostración.**

La configuración activa del `.env` apunta a **Supabase (PostgreSQL)**, la misma
base que usarás al desplegar en Railway. SQLite local queda como alternativa
comentada en el mismo archivo.

## 1. Qué levanta

| Servicio | Puerto | Descripción |
|---|---|---|
| Web (Vite) | `5185` | Interfaz de usuario |
| API (FastAPI) | `8012` | Endpoints, documentación y salud |
| Worker | — | Procesa los entrenamientos en segundo plano |

La base de datos es **Supabase** (PostgreSQL, Session pooler 5432):

```text
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
```

Los CSV, modelos y preprocesadores siguen guardándose en disco local mientras
`STORAGE_BACKEND=local`:

```text
services/api/data/uploads   → CSV y eventos
services/api/data/models    → modelos .keras, preprocesadores y manifiestos
```

Los registros de la base apuntan a esas rutas. Si borras esos archivos, los
modelos existentes en Supabase dejarán de poder descargarse o evaluarse. En
Railway esos artefactos irán a Supabase Storage (ver
`docs/DESPLIEGUE_VERCEL_RAILWAY.md`).

Los puertos `8000` y `5173` están reservados para otro proyecto de este equipo
(VisionIA). Por eso NeuroLab usa `8012` y `5185`.

## 2. Arrancar

Desde la raíz del repositorio:

```powershell
cd C:\Users\sanhu\Desktop\NeuroLab_Enterprise
powershell -ExecutionPolicy Bypass -File scripts/start_local.ps1
```

El script:

1. Para la instancia anterior si existe.
2. Comprueba que los puertos estén libres.
3. Arranca la API y espera a que su salud sea real (`neurolab-api`).
4. Arranca el worker persistente y espera su calentamiento (TensorFlow tarda
   unos 20 s en importar).
5. Arranca la web y guarda los PID en `%TEMP%\neurolab_local\pids.json`.

Si necesita otros puertos:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start_local.ps1 -ApiPort 8022 -WebPort 5195
```

## 3. Abrir la aplicación

| Recurso | URL |
|---|---|
| Aplicación | http://127.0.0.1:5185 |
| API | http://127.0.0.1:8012 |
| Swagger | http://127.0.0.1:8012/api/v1/docs |
| Salud | http://127.0.0.1:8012/health |

Credenciales iniciales (definidas en `.env`):

```text
Usuario:    admin@neurolab.enterprise
Contraseña: Admin123!
```

## 4. Primer recorrido recomendado

La base muestra tus proyectos reales de Supabase. El flujo está guiado para que
no tengas que buscar cada módulo.

1. Entre a **Proyectos** y pulse **Crear Proyecto**. Complete **nombre**,
   **descripción** y **tipo de red** (para CSV tabular: `Feedforward`).
2. Al guardar, la app te lleva automáticamente a **Conjuntos de datos** y abre
   el modal de carga del CSV.
3. Elija el archivo, escriba el nombre e indique la **columna objetivo**. La API
   valida encabezados, tamaño, tipos y detecta `classification` o `regression`.
4. Al registrarse el dataset, la app abre **Diseñador de redes** con ese dataset
   ya seleccionado. Ajuste las capas y pulse **Guardar Arquitectura**; la
   validación dimensional se ejecuta en el servidor.
5. Al guardar, la app abre **Entrenamientos** con arquitectura y dataset
   preseleccionados. Revise épocas, lote, optimizador y tasa de aprendizaje, y
   pulse **Iniciar Entrenamiento**.
6. El worker toma el trabajo en menos de un segundo y muestra la telemetría en
   vivo. El estado debe pasar de `QUEUED` a `RUNNING`.
7. Al terminar, revise **Evaluación y métricas**, luego **Registro de modelos**
   para el ciclo `DRAFT → REVIEWED → APPROVED`.
8. **Ficha técnica** genera la documentación a partir de los datos persistidos.

También puedes seleccionar un proyecto existente desde el selector superior;
en ese caso la navegación queda a tu elección.

Todo lo que vea será calculado con sus propios datos: no hay rutas mock ni
métricas inventadas en el frontend.

## 5. Detener

```powershell
cd C:\Users\sanhu\Desktop\NeuroLab_Enterprise
powershell -ExecutionPolicy Bypass -File scripts/stop_local.ps1
```

Solo detiene los procesos que arrancó `start_local.ps1` (API, worker y web), no
los procesos que ocupen un puerto. VisionIA no se ve afectado.

## 6. Logs y diagnóstico

Los logs están en:

```text
%TEMP%\neurolab_local\
```

| Archivo | Contenido |
|---|---|
| `api.log` / `api.err.log` | API |
| `worker.log` / `worker.err.log` | Worker y entrenamientos |
| `web.log` / `web.err.log` | Vite |
| `pids.json` | Procesos de la instancia activa |

Comprobación rápida de salud:

```powershell
Invoke-RestMethod http://127.0.0.1:8012/health | ConvertTo-Json
```

Debe responder con `service: neurolab-api`, `database: up` y
`environment: development`. `redis: down` es normal en local: la app usa sondeo
a la base y la cola en disco.

## 7. Cambiar temporalmente a SQLite local

La configuración activa es Supabase. Si necesitas trabajar sin red, edita `.env`:

```text
# Comenta la línea de Supabase
# DATABASE_URL=postgresql://postgres.<ref>:...

# Activa SQLite local
DATABASE_URL=sqlite+aiosqlite:///C:/Users/sanhu/Desktop/NeuroLab_Enterprise/services/api/data/neurolab.db
```

Reinicia con `scripts/start_local.ps1`. La app mostrará los datos de
`services/api/data/neurolab.db` (distintos de los de Supabase). Para volver a
Supabase, invierte los comentarios y reinicia otra vez.

## 8. Verificar qué base está activa

```powershell
Invoke-RestMethod http://127.0.0.1:8012/health | ConvertTo-Json
```

Debe responder `database: up`. Para confirmar que es Supabase, revisa el
`DATABASE_URL` activo en `.env` o consulta la API:

```powershell
# Proyectos reales que verá la app
$login = Invoke-RestMethod -Method Post http://127.0.0.1:8012/api/v1/auth/login `
  -ContentType 'application/json' `
  -Body '{"email":"admin@neurolab.enterprise","password":"Admin123!"}'
Invoke-RestMethod http://127.0.0.1:8012/api/v1/projects `
  -Headers @{ Authorization = "Bearer $($login.access_token)" } |
  Select-Object id, name, networkFamily
```

## 9. Pruebas automáticas

```powershell
cd C:\Users\sanhu\Desktop\NeuroLab_Enterprise\services\api
python -m pytest tests -q

cd C:\Users\sanhu\Desktop\NeuroLab_Enterprise
python -m pytest workers\training\tests -q
python -m ruff check .

cd C:\Users\sanhu\Desktop\NeuroLab_Enterprise\apps\web
npm.cmd run build
```

## 10. Problemas comunes

| Síntoma | Causa | Solución |
|---|---|---|
| «El puerto ya está en uso» | Otra aplicación ocupa el puerto | Use `-ApiPort` / `-WebPort` o cierre esa aplicación |
| La API no responde | Error de arranque o esquema | Revise `api.err.log` |
| El trabajo queda en `QUEUED` | Worker detenido | Arranque de nuevo sin `-NoWorker` y revise `worker.err.log` |
| El primer entrenamiento tarda unos segundos | Worker calentando TensorFlow | Es normal solo al arrancar; luego toma trabajos en <1 s |
| La web no carga | Vite caído | Revise `web.err.log` y reinicie con el script |
| `redis: down` | Redis no instalado | Es normal en local; no bloquea entrenamientos |

## 11. Despliegue en Vercel y Railway

Cuando la app funcione en local, sigue
`docs/DESPLIEGUE_VERCEL_RAILWAY.md`. Incluye Supabase Storage, variables de
entorno, los archivos `railway.api.json` / `railway.worker.json` y la
configuración del frontend en Vercel.

## 12. Nota sobre la guía antigua

`docs/GUIA_DE_PRUEBAS.md` y `docs/DEMO_EXPOSICION.md` describen la antigua
instancia de demostración con datos sembrados. No son el arranque activo. Para
la aplicación real use este documento y `scripts/start_local.ps1`.
