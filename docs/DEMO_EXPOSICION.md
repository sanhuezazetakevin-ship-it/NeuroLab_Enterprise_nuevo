# Guía de exposición — Demo local de NeuroLab Enterprise

Esta guía acompaña la demo local que se levanta con `scripts/start_demo.ps1`.
Usa una base **SQLite temporal** y carpetas temporales: **no toca Supabase ni
los datos reales** del proyecto.

---

## 1. Arranque

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start_demo.ps1 -Fresh
```

El script:

1. Detiene cualquier demo anterior en los puertos indicados.
2. Borra y recrea la carpeta de trabajo (con reintentos si Windows mantiene
   archivos bloqueados).
3. Arranca la API y espera el healthcheck.
4. Siembra el proyecto, el dataset y entrena un modelo real con el worker.
5. Arranca el frontend y el **worker persistente precalentado**; espera a que
   ambos respondan. El worker importa TensorFlow una sola vez (~20 s) y queda
   listo para que los entrenamientos empiecen en menos de un segundo.

Al terminar, abre:

| Recurso | URL |
|---|---|
| Aplicación web | http://127.0.0.1:5173 |
| API | http://127.0.0.1:8000 |
| Swagger UI | http://127.0.0.1:8000/api/v1/docs |
| Healthcheck | http://127.0.0.1:8000/health |

La carpeta de trabajo por defecto es `%TEMP%\neurolab_demo`. El script imprime
la ruta exacta al iniciar. Puedes cambiarla con `-DemoDir` y los puertos con
`-ApiPort` / `-WebPort`.

### Credenciales

| Rol | Correo | Contraseña |
|---|---|---|
| ADMIN | `admin@neurolab.enterprise` | `Admin123!` |
| REVIEWER | `revisor@instituto.edu` | `Revisor123!` |

### Detener la demo

```powershell
powershell -ExecutionPolicy Bypass -File scripts/stop_demo.ps1
```

Detiene el árbol completo de procesos (npm → cmd → node) y libera los puertos.

---

## 2. Qué queda cargado

- Proyecto **Predicción de Abandono de Clientes**.
- Dataset real `data_prueba_clientes.csv`: **600 filas**, 7 columnas, target
  `abandono`, tarea `classification`, **9 neuronas de entrada** tras one-hot.
- Partición determinista **70 / 15 / 15** (420 / 90 / 90).
- Arquitectura **MLP de referencia** (32 → 16 → 1).
- Modelo **v1.0** entrenado, aprobado y con artefactos `.keras` + checksums.
- Arquitectura **MLP profunda** (64 → 32 → 16 → 1) lista para lanzar un
  entrenamiento en vivo desde la interfaz.
- **Worker persistente precalentado**: el trabajo pasa de la cola a ejecución
  en menos de un segundo (sin esperar la importación de TensorFlow).
- Usuario **REVIEWER** asignado al proyecto.
- Historial de auditoría con todas las acciones.

Métricas reales del modelo v1.0 sembrado:

| Métrica | Valor |
|---|---|
| Test accuracy | **84.44 %** |
| Balanced accuracy | **86.77 %** |
| Precision | **65.71 %** |
| Recall | **92.00 %** |
| F1-score | **76.67 %** |
| ROC-AUC | **89.91 %** |
| Umbral de decisión | **0.4094** |
| Épocas | **15** |

Los valores pueden variar ligeramente si se reentrena con otra semilla. Al
entrenar en vivo se crea una nueva versión (**v1.1**) con sus propias métricas.

---

## 3. Ruta de exposición (5–7 minutos)

### Paso 0 — Login
Entra con el usuario **ADMIN**. Menciona que la sesión usa **JWT** y que el rol
efectivo cambia los permisos de toda la interfaz.

### Paso 1 — Panel
**Menú:** `Panel`

Qué mostrar:
- KPIs: arquitecturas, datasets, entrenamientos, versiones de modelo.
- Trabajos recientes con estado (`COMPLETED`, `QUEUED`).
- Estado de la plataforma: base de datos `up`, cola `filesystem`, uptime.
- Actividad de auditoría reciente.

Qué decir:
> “El panel no inventa datos: todo se lee de la base y de los artefactos del
> worker.”

### Paso 2 — Proyectos
**Menú:** `Proyectos`

Qué mostrar:
- Proyecto aislado con rol global `ADMIN`.
- Contadores de arquitecturas, datasets y trabajos.
- Selector de proyecto en la barra superior (cambia el contexto global).

### Paso 3 — Fundamentos (valor académico)
**Menú:** `Fundamentos`

Qué mostrar:
- Simulador del perceptrón: entradas `x1`, `x2`, pesos `w1`, `w2`, sesgo `b`.
- Cambia un peso o el sesgo y observa cómo se actualizan en vivo:
  combinación lineal, grafo sináptico, curva de activación, frontera 2D y
  gradiente.
- Evaluación rápida tipo checkpoint.

Qué decir:
> “Este módulo explica la matemática que hay detrás de cada capa; es ideal para
> un instituto porque conecta teoría y práctica.”

### Paso 4 — Diseñador de Redes
**Menú:** `Diseñador de Redes`

Qué mostrar:
- La entrada se fija desde el CSV: **9 neuronas**.
- La salida la impone el target: **1 neurona con `sigmoid`**.
- El resumen técnico Keras: parámetros totales, memoria de pesos, salida
  `[null, 1]`.
- La validación del servidor: “Topología válida”.
- Plantilla **CNN**: verás `Conv1D` y `MaxPooling1D` (no 2D), porque los datos
  son tabulares.
- Si se intenta validar una capa `Conv2D`/`MaxPooling2D` por API, el servidor
  la **rechaza** con un mensaje claro.

Qué decir:
> “La interfaz ayuda, pero la fuente de verdad es el validador de FastAPI:
> comprueba dimensiones, parámetros y compatibilidad antes de guardar.”

### Paso 5 — Conjuntos de datos
**Menú:** `Conjuntos de datos`

Qué mostrar:
- Dataset **verificado** con checksum **SHA-256**.
- Vista previa de las primeras filas y tipos de columna.
- Partición **70 / 15 / 15** y la nota de que el escalado se ajusta solo con
  `Train` para evitar fuga de datos.

### Paso 6 — Entrenamientos (el momento fuerte)
**Menú:** `Entrenamientos`

Opción A — mostrar el historial:
- Trabajo completado de **15 épocas**, con pérdida/exactitud y curvas.
- Modelo **v1.0** aprobado con **84.44 %** de exactitud en test.

Opción B — entrenar en vivo:
1. Selecciona la arquitectura `MLP profunda (entrenamiento en vivo)`.
2. Selecciona el dataset `Clientes del instituto`.
3. Columna objetivo: `abandono`.
4. Épocas: `30` o `60`; tamaño de lote: `8`.
5. Pulsa **Iniciar Entrenamiento**.

El worker persistente ya está activo: el trabajo pasa a `En ejecución` en
menos de un segundo, sin comandos adicionales ni espera de importación.

Mientras corre verás:
- Estado `En ejecución` y barra de progreso.
- **SSE en vivo** y actualización de época, pérdida y exactitud.
- Al terminar: estado `Completado`, `100 %`, nueva versión de modelo.

> Si arrancaste la demo con `-NoWorker`, procesa el trabajo manualmente con
> `scripts/run_worker_once.ps1` (paga ~20 s de importación de TensorFlow).

Qué decir:
> “El entrenamiento no ocurre en el navegador: lo ejecuta un worker aislado de
> TensorFlow/Keras. La web solo recibe telemetría por SSE y, si se cae la
> conexión, se recupera desde la base.”

### Paso 7 — Evaluación & Métricas
**Menú:** `Evaluación & Métricas`

Qué mostrar:
- Test Accuracy, Test Loss, F1, Precision/Recall.
- **Matriz de confusión** sobre las 90 muestras de test.
- Comparación de versiones (`v1.0` y la `v1.1` que se cree en vivo).
- Checksum del artefacto y trazabilidad de la evaluación.

Qué decir:
> “Las métricas las calcula el worker sobre el conjunto de test reservado; no
> se generan curvas sintéticas en el cliente.”

### Paso 8 — Registro de Modelos
**Menú:** `Registro de Modelos`

Qué mostrar:
- Ciclo de vida **DRAFT → REVIEWED → APPROVED → RETIRED**.
- Filtros por estado.
- Checksum **SHA-256** por versión y botón “Copiar Hash”.
- `Ficha`: model card generada por el worker.
- `Descargar .keras`: artefacto real.
- `Probar modelo`:
  1. Se abre el formulario con el esquema real del entrenamiento.
  2. Pulsa **Ejecutar predicción**.
  3. Verás clase predicha, probabilidad, umbral y distribución.
- Pestañas **Lote CSV** e **Integración API** (cURL / Python / JavaScript).

Qué decir:
> “Un modelo solo se puede usar en producción cuando pasa por revisión y
> aprobación. Cada versión queda atada a su checksum y a su job de origen.”

### Paso 9 — Ficha Técnica
**Menú:** `Ficha Técnica`

Qué mostrar:
- **Model Audit Card** con topología compilada, métricas, hiperparámetros y
  pista de auditoría.
- Exportar **CSV**, **JSON** e **Imprimir / PDF**.

Qué decir:
> “Este documento sirve como evidencia formal para un comité académico o de
> auditoría: se genera solo con datos persistidos.”

### Paso 10 — Administración
**Menú:** `Administración`

Qué mostrar:
- Directorio de usuarios y roles.
- Matriz **RBAC** por módulo.
- Estado del sistema y límites configurados.
- Registro de auditoría con metadata de cada acción.

### Cierre — Guía de Cliente
**Botón:** `Guía de Cliente` (abajo a la izquierda)

Es un recorrido guiado de **7 pasos** que va navegando solo por los módulos.
Ideal para cerrar la exposición o para que el jurado lo explore sin ayuda.

---

## 4. Diferencias esperadas en local

- `Redis: down` es normal en la demo local: la cola usa `filesystem` y la
  telemetría tiene respaldo por sondeo a la base.
- `/metrics` funciona en modo fallback si `prometheus-client` no está instalado;
  en Docker/despliegue se usa Prometheus real.
- Los artefactos y la base viven en `%TEMP%\neurolab_demo`, por lo que se pueden
  borrar sin afectar al proyecto. El script imprime la ruta exacta.
- El entrenamiento real tarda unos segundos porque el dataset es pequeño
  (600 filas); en un dataset grande el worker sigue igual, solo tarda más.

---

## 5. Estructura técnica que puedes mencionar

| Pieza | Tecnología |
|---|---|
| Frontend | React 19 + Vite + Tailwind |
| API | FastAPI + SQLAlchemy async + Pydantic |
| Base de datos | PostgreSQL en producción / SQLite en la demo |
| Worker | TensorFlow/Keras + scikit-learn + pandas |
| Cola | Redis en producción / filesystem en local |
| Telemetría | SSE + respaldo por polling a la base |
| Seguridad | JWT + RBAC por proyecto + auditoría |
| Integridad | SHA-256 por dataset y por artefacto de modelo |
| Migraciones | Alembic (`alembic upgrade head`) |

---

## 6. Comandos útiles

```powershell
# Arrancar demo limpia (API + web + worker persistente precalentado)
powershell -ExecutionPolicy Bypass -File scripts/start_demo.ps1 -Fresh

# Modo manual: no arranca el worker; luego procesa el job a mano
powershell -ExecutionPolicy Bypass -File scripts/start_demo.ps1 -Fresh -NoWorker
powershell -ExecutionPolicy Bypass -File scripts/run_worker_once.ps1 -JobId <uuid>

# Detener demo (API, web y worker)
powershell -ExecutionPolicy Bypass -File scripts/stop_demo.ps1

# Pruebas automáticas
cd services\api; python -m pytest tests -q
cd ..\..; python -m pytest workers\training\tests -q
cd apps\web; npm.cmd run build
```

Más documentación: `README.md`, `docs/architecture/`, `docs/api/`,
`docs/operations/`.
