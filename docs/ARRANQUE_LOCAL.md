# Arranque local real (sin demo)

Esta es la forma de arrancar NeuroLab Enterprise en este equipo para probarlo
con una base propia y datos reales. **No se siembran proyectos, datasets ni
entrenamientos de demostración.**

## 1. Qué levanta

| Servicio | Puerto | Descripción |
|---|---|---|
| Web (Vite) | `5185` | Interfaz de usuario |
| API (FastAPI) | `8012` | Endpoints, documentación y salud |
| Worker | — | Procesa los entrenamientos en segundo plano |

La base de datos es SQLite local:

```text
services/api/data/neurolab.db
```

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

La base empieza limpia: solo existe el usuario administrador y **0 proyectos**.

1. Entre a **Proyectos** y cree su primer proyecto.
2. Abra **Conjuntos de datos** y cargue un CSV real. La API valida encabezados,
   tamaño, columna objetivo y detecta si la tarea es `classification` o
   `regression`.
3. Abra **Diseñador de redes**, defina las capas y guarde la arquitectura. La
   validación dimensional se ejecuta en el servidor.
4. Abra **Entrenamientos**, elija arquitectura, dataset, columna objetivo,
   épocas y demás hiperparámetros, y pulse **Iniciar Entrenamiento**.
5. El worker debe tomar el trabajo en menos de un segundo y mostrar la
   telemetría en vivo.
6. Al terminar, revise **Evaluación y métricas**, luego **Registro de modelos**
   para el ciclo `DRAFT → REVIEWED → APPROVED`.
7. **Ficha técnica** genera la documentación a partir de los datos persistidos.

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

## 7. Reiniciar con una base vacía

Detenga la aplicación y aparte la base actual (se conserva como copia):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/stop_local.ps1

$db = "C:\Users\sanhu\Desktop\NeuroLab_Enterprise\services\api\data\neurolab.db"
if (Test-Path $db) { Move-Item $db "$db.bak-$(Get-Date -Format yyyyMMdd-HHmmss)" }

powershell -ExecutionPolicy Bypass -File scripts/start_local.ps1
```

La API crea el esquema y vuelve a sembrar solo el administrador.

## 8. Pruebas automáticas

```powershell
cd C:\Users\sanhu\Desktop\NeuroLab_Enterprise\services\api
python -m pytest tests -q

cd C:\Users\sanhu\Desktop\NeuroLab_Enterprise
python -m pytest workers\training\tests -q
python -m ruff check .

cd C:\Users\sanhu\Desktop\NeuroLab_Enterprise\apps\web
npm.cmd run build
```

## 9. Problemas comunes

| Síntoma | Causa | Solución |
|---|---|---|
| «El puerto ya está en uso» | Otra aplicación ocupa el puerto | Use `-ApiPort` / `-WebPort` o cierre esa aplicación |
| La API no responde | Error de arranque o esquema | Revise `api.err.log` |
| El trabajo queda en `QUEUED` | Worker detenido | Arranque de nuevo sin `-NoWorker` y revise `worker.err.log` |
| El primer entrenamiento tarda unos segundos | Worker calentando TensorFlow | Es normal solo al arrancar; luego toma trabajos en <1 s |
| La web no carga | Vite caído | Revise `web.err.log` y reinicie con el script |
| `redis: down` | Redis no instalado | Es normal en local; no bloquea entrenamientos |

## 10. Nota sobre la guía antigua

`docs/GUIA_DE_PRUEBAS.md` y `docs/DEMO_EXPOSICION.md` describen la antigua
instancia de demostración con datos sembrados. No son el arranque activo. Para
la aplicación real use este documento y `scripts/start_local.ps1`.
