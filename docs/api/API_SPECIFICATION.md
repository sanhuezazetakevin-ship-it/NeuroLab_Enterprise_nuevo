# Especificación de API v1 y eventos

- **Prefijo base:** `/api/v1`
- **Formato:** `application/json` (salvo `multipart/form-data` en la carga de CSV, `text/event-stream` en SSE y `text/markdown` en la ficha del modelo)
- **Autenticación:** `Authorization: Bearer <JWT>`
- **Token:** HS256, expiración por defecto 480 minutos (`expires_in` se expresa en segundos)
- **OpenAPI:** `GET /api/v1/openapi.json` · **Swagger UI:** `GET /api/v1/docs` · **ReDoc:** `/api/v1/redoc`

Documentación interactiva adicional:

- `GET /health` — público, sin prefijo v1. Devuelve `200` si la base de datos responde y `503` si no.
- `GET /` — público. Nombre, versión y enlace a Swagger.

---

## 1. Formato de errores

FastAPI devuelve un objeto con `detail`. El contenido depende del tipo de error:

```json
{ "detail": "Mensaje legible para el usuario" }
```

Validación de cuerpo/query (Pydantic, `422`):

```json
{
  "detail": [
    {
      "type": "string_too_short",
      "loc": ["body", "name"],
      "msg": "String should have at least 3 characters",
      "input": "ab",
      "ctx": { "min_length": 3 }
    }
  ]
}
```

Errores de negocio compuestos (por ejemplo, arquitectura inválida, `422`):

```json
{
  "detail": {
    "message": "Arquitectura inválida",
    "errors": ["La arquitectura debe contener al menos una capa."]
  }
}
```

Códigos usados:

| Código | Significado |
|---|---|
| `400` | Solicitud inválida (archivo no CSV, ruta inválida, operación no permitida) |
| `401` | Token ausente, inválido o usuario inactivo |
| `403` | Rol insuficiente |
| `404` | Recurso inexistente o proyecto sin acceso (no se revela su existencia) |
| `409` | Conflicto de estado o de unicidad |
| `413` | Archivo mayor al límite permitido |
| `422` | Validación de esquema/negocio |
| `429` | Rate limit de login excedido |
| `503` | Cola de entrenamientos no disponible, o inferencia sin dependencias opcionales |

Los endpoints de proyecto devuelven `404` cuando el usuario no es miembro ni propietario, incluso si el proyecto existe.

---

## 2. Autenticación (`/auth`)

### `POST /auth/login`

Público. Rate limit por IP: `LOGIN_RATE_LIMIT_PER_MINUTE` (por defecto 10/min) → `429`.

```json
{
  "email": "admin@neurolab.enterprise",
  "password": "<SEED_ADMIN_PASSWORD>"
}
```

`200 OK`:

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer",
  "expires_in": 28800,
  "user": {
    "id": "c138d879-112e-4b44-b0db-6e1d283626fa",
    "email": "admin@neurolab.enterprise",
    "display_name": "Administrador NeuroLab",
    "role": "ADMIN",
    "status": "ACTIVE",
    "created_at": "2026-11-01T15:30:00Z"
  }
}
```

- `401`: correo/contraseña incorrectos.
- `403`: cuenta `INACTIVE` o `SUSPENDED`.
- Cada login exitoso registra `USER_LOGIN` en auditoría.

### `GET /auth/me`

`200 OK` → `UserResponse` del usuario autenticado.

### `POST /auth/change-password`

```json
{
  "current_password": "<contraseña-actual>",
  "new_password": "NuevaClaveSegura123!"
}
```

- `new_password`: mínimo 10 caracteres y distinta de la actual.
- `200 OK`: `{ "message": "Contraseña actualizada correctamente" }`
- `400`: contraseña actual incorrecta o nueva igual a la anterior.

---

## 3. Proyectos (`/projects`)

### `GET /projects`

Lista los proyectos accesibles. `ADMIN` ve todos; el resto ve proyectos propios o donde es miembro.

`200 OK`:

```json
[
  {
    "id": "4d3f...",
    "name": "Detección de Fraude",
    "description": "Clasificación binaria de transacciones.",
    "owner_id": "c138...",
    "status": "ACTIVE",
    "network_family": "FEEDFORWARD",
    "created_at": "2026-11-01T15:30:00Z",
    "updated_at": "2026-11-01T15:30:00Z",
    "architectures_count": 2,
    "datasets_count": 1,
    "jobs_count": 5,
    "effective_role": "PROJECT_LEAD"
  }
]
```

`effective_role` puede ser `ADMIN`, `PROJECT_LEAD`, `AI_ENGINEER`, `REVIEWER` o `VIEWER`.

### `POST /projects`

Roles permitidos: `ADMIN`, `PROJECT_LEAD`, `AI_ENGINEER`.

```json
{
  "name": "Detección de Fraude",
  "description": "Clasificación binaria de transacciones.",
  "network_family": "FEEDFORWARD"
}
```

- `name`: 3–200 caracteres; `description`: hasta 4000.
- `network_family`: `FEEDFORWARD` (default), `RNN`, `CNN` o `GAN`. Define la familia inicial del diseñador.
- `201 Created` → `ProjectResponse`.
- El creador queda como `owner_id`; su rol efectivo es `PROJECT_LEAD`.

### `GET /projects/{project_id}`

`200 OK` → `ProjectResponse`. `404` si no existe o no hay acceso.

### `PATCH /projects/{project_id}`

Roles: `ADMIN` o `PROJECT_LEAD` efectivo en el proyecto.

```json
{
  "name": "Nombre actualizado",
  "description": "Nuevo alcance",
  "status": "ARCHIVED"
}
```

Todos los campos son opcionales. `status`: `ACTIVE` o `ARCHIVED`.

### Miembros

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/projects/{id}/members` | Lista miembros con `email` y `display_name` |
| `POST` | `/projects/{id}/members` | Alta o actualización por email |
| `DELETE` | `/projects/{id}/members/{user_id}` | Elimina la membresía (`204`) |

`POST` body:

```json
{ "email": "engineer@empresa.com", "role": "AI_ENGINEER" }
```

- Requiere `ADMIN` o `PROJECT_LEAD`.
- `404` si el usuario no existe.
- `400` si se intenta añadir al propietario.
- Si ya existía, actualiza el rol.

---

## 4. Arquitecturas (`/projects/{project_id}/architectures`)

### `POST /projects/{project_id}/architectures/validate?family=FEEDFORWARD`

Valida una topología sin persistirla. El cuerpo es la topología directamente:

```json
{
  "input_shape": [30],
  "layers": [
    { "type": "Dense", "units": 64, "activation": "relu" },
    { "type": "Dropout", "rate": 0.2 },
    { "type": "Dense", "units": 32, "activation": "relu" },
    { "type": "Dense", "units": 1, "activation": "sigmoid" }
  ]
}
```

`family` (query): `FEEDFORWARD`, `RNN`, `CNN` o `GAN`. Por defecto `FEEDFORWARD`.

`200 OK`:

```json
{
  "valid": true,
  "total_parameters": 2433,
  "trainable_parameters": 2433,
  "output_shape": [null, 1],
  "warnings": [],
  "errors": [],
  "trainable": true,
  "trainable_reason": null
}
```

Cuando `trainable` es `false`, `trainable_reason` explica por qué el worker no puede entrenarla (por ejemplo, familia no habilitada en el MVP).

### `GET /projects/{project_id}/architectures`

`200 OK` → lista de arquitecturas ordenadas por creación descendente.

### `POST /projects/{project_id}/architectures`

Roles de escritura: `ADMIN`, `PROJECT_LEAD`, `AI_ENGINEER`.

```json
{
  "name": "MLP Fraud Classifier",
  "family": "FEEDFORWARD",
  "config_json": {
    "input_shape": [30],
    "layers": [
      { "type": "Dense", "units": 64, "activation": "relu" },
      { "type": "Dropout", "rate": 0.2 },
      { "type": "Dense", "units": 32, "activation": "relu" },
      { "type": "Dense", "units": 1, "activation": "sigmoid" }
    ]
  }
}
```

- `name`: 3–200; `family`: `FEEDFORWARD|RNN|CNN|GAN`.
- `version` se incrementa por nombre dentro del proyecto.
- `201 Created` → `ArchitectureResponse`.
- `422` si la validación dimensional falla.

Capas soportadas por el validador: `Dense`, `Dropout`, `BatchNormalization`, `Flatten`, `Conv1D`, `MaxPooling1D`, `Conv2D`, `MaxPooling2D`, `LSTM`, `GRU`, `SimpleRNN`.
Para entrenamiento tabular se usan `Conv1D`/`MaxPooling1D`; las capas 2D se rechazan en la familia CNN.
Activaciones: `relu`, `sigmoid`, `tanh`, `softmax`, `linear`, `leaky_relu`, `elu`, `swish`.

### `GET /projects/{project_id}/architectures/{architecture_id}`

`200 OK` → `ArchitectureResponse`; `404` si no pertenece al proyecto.

---

## 5. Datasets (`/projects/{project_id}/datasets`)

### `GET /projects/{project_id}/datasets`

`200 OK` → lista de `DatasetResponse`:

```json
{
  "id": "f5e4...",
  "project_id": "4d3f...",
  "name": "churn",
  "version": "v1.0",
  "storage_key": "datasets/4d3f.../f5e4....csv",
  "original_filename": "churn.csv",
  "size_bytes": 18432,
  "checksum": "e3b0c442...",
  "target_column": "abandono",
  "verified": true,
  "metadata_json": {
    "samples": 40,
    "features_count": 3,
    "target_column": "abandono",
    "task": "classification",
    "neurons": {
      "available": true,
      "input_neurons": 9,
      "output_neurons": 1,
      "output_activation": "sigmoid",
      "loss": "binary_crossentropy",
      "class_labels": ["0", "1"],
      "class_count": 2,
      "features": [
        { "name": "edad", "kind": "numeric", "neurons": 1 },
        { "name": "ciudad", "kind": "one_hot", "neurons": 3, "values": ["Arequipa", "Cusco", "Lima"] }
      ],
      "truncated": false
    },
    "columns": [
      { "name": "edad", "dtype": "int64", "null_count": 0, "unique": 40 }
    ],
    "null_counts": { "edad": 0 },
    "dtypes": { "edad": "int64" },
    "train_split": 0.7,
    "val_split": 0.15,
    "test_split": 0.15,
    "verified": true
  },
  "created_at": "2026-11-01T15:30:00Z"
}
```

### `POST /projects/{project_id}/datasets/upload`

`multipart/form-data`:

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `file` | archivo | Sí | Debe terminar en `.csv` |
| `name` | texto | No | Por defecto, nombre del archivo sin extensión |
| `target_column` | texto | No | Si se indica, se valida y se detecta la tarea |

- Roles de escritura.
- `201 Created` → `DatasetResponse`.
- `400`: extensión distinta de `.csv`.
- `413`: supera `MAX_UPLOAD_MB` (por defecto 50 MB).
- `422`: CSV inválido (encabezados, filas, columnas, target).
- Registra `DATASET_UPLOADED` con checksum y número de filas.

Reglas de validación:

- Encabezados explícitos, no vacíos, sin duplicados.
- Al menos 2 columnas y entre 10 y 500.000 filas.
- El target debe existir y tener al menos 2 valores distintos.
- La tarea se infiere: columnas categóricas o pocos valores únicos → `classification`; en otro caso → `regression`.
- `metadata_json.neurons` calcula la forma real del modelo con las mismas reglas del worker: columna numérica → 1 neurona; categórica con ≤30 valores → one-hot (una neurona por valor); resto → ordinal (1 neurona). La salida es 1 + `sigmoid` para binaria, N + `softmax` para multiclase y 1 + `linear` para regresión.
- Antes de encolar un entrenamiento, la API rechaza con `422` si `input_shape[0]` no coincide con `metadata_json.neurons.input_neurons`.

### `GET /projects/{project_id}/datasets/{dataset_id}`

`200 OK` → `DatasetResponse`; `404` si no existe o pertenece a otro proyecto.

### `GET /projects/{project_id}/datasets/{dataset_id}/preview`

`200 OK`:

```json
{
  "id": "f5e4...",
  "columns": ["edad", "ingreso", "visitas", "abandono"],
  "dtypes": { "edad": "int64", "abandono": "int64" },
  "rows": [ { "edad": 20, "ingreso": 30000, "visitas": 0, "abandono": 1 } ],
  "total_rows": 40,
  "null_counts": { "edad": 0, "abandono": 0 }
}
```

Devuelve hasta 10 filas.

### `DELETE /projects/{project_id}/datasets/{dataset_id}`

- Roles de escritura.
- `204 No Content`.
- `409` si existe un entrenamiento que referencia el dataset (se conserva la trazabilidad).
- Elimina el archivo del almacenamiento compartido.

---

## 6. Entrenamientos (`/training-jobs`)

### `GET /projects/{project_id}/training-jobs`

`200 OK` → lista de `TrainingJobResponse` ordenada por creación descendente.

### `POST /projects/{project_id}/training-jobs`

Roles de escritura. Requiere arquitectura y dataset del mismo proyecto, dataset verificado, arquitectura válida y **entrenable**.

```json
{
  "architecture_id": "9a2f7c04-...",
  "dataset_id": "f5e4d3c2-...",
  "target_column": "abandono",
  "task": "classification",
  "hyperparameters": {
    "epochs": 50,
    "batch_size": 32,
    "optimizer": "adam",
    "learning_rate": 0.001,
    "loss": null,
    "metrics": ["accuracy"],
    "random_seed": 42,
    "validation_split": 0.15,
    "deterministic": true,
    "early_stopping": true,
    "early_stopping_patience": 5,
    "reduce_lr_on_plateau": true
  }
}
```

Campos de hiperparámetros:

| Campo | Rango / valores | Por defecto |
|---|---|---|
| `epochs` | 1–1000 | `30` |
| `batch_size` | 1–4096 | `32` |
| `optimizer` | `adam`, `sgd`, `rmsprop` | `adam` |
| `learning_rate` | `> 0` y `≤ 1` | `0.001` |
| `loss` | opcional; el worker elige según la tarea | `null` |
| `metrics` | lista de nombres Keras | `["accuracy"]` |
| `random_seed` | 0–2³¹−1 | `42` |
| `validation_split` | `> 0` y `< 0.5` | `0.15` |
| `deterministic` | booleano; activa `enable_op_determinism` | `false` |
| `early_stopping` | booleano | `true` |
| `early_stopping_patience` | 1–50 | `5` |
| `reduce_lr_on_plateau` | booleano | `true` |

La API añade al job `target_column`, `task`, `dataset_checksum`, `dataset_version` y `code_version` para reproducibilidad.

`202 Accepted` → `TrainingJobResponse` (estado `QUEUED`):

```json
{
  "id": "7b89211c-...",
  "project_id": "4d3f...",
  "architecture_id": "9a2f...",
  "dataset_id": "f5e4...",
  "status": "QUEUED",
  "progress": 0.0,
  "hyperparameters": { "epochs": 50, "batch_size": 32, "...": "..." },
  "cancel_requested": false,
  "started_at": null,
  "ended_at": null,
  "error_message": null,
  "created_at": "2026-11-01T15:30:00Z",
  "metrics": []
}
```

Errores:

- `422` arquitectura/dataset de otro proyecto, dataset no verificado, arquitectura inválida, target inexistente, tarea no determinable o familia no entrenable.
- `503` si la cola no está disponible. El job queda `FAILED` con `error_message` y se audita `TRAINING_JOB_ENQUEUE_FAILED`.

### `GET /training-jobs/{job_id}`

`200 OK` → `TrainingJobResponse` con `metrics` ya agregadas por época:

```json
"metrics": [
  { "epoch": 1, "loss": 0.6712, "accuracy": 0.7421, "val_loss": 0.6123, "val_accuracy": 0.7810 }
]
```

### `GET /training-jobs/{job_id}/metrics`

`200 OK` → filas crudas:

```json
[
  {
    "id": 1,
    "job_id": "7b89...",
    "epoch": 1,
    "metric_name": "loss",
    "metric_value": 0.6712,
    "recorded_at": "2026-11-01T15:31:00Z"
  }
]
```

### `POST /training-jobs/{job_id}/cancel`

Roles de escritura. El comportamiento depende del estado del trabajo:

- `QUEUED`: se cancela de inmediato, sin esperar a un worker, y se retira el
  descriptor de la cola. La respuesta ya devuelve `status: "CANCELLED"`.
- `PREPARING` / `RUNNING`: marca `cancel_requested=true`, audita
  `TRAINING_JOB_CANCEL_REQUESTED` y notifica al worker, que aplica la
  cancelación al finalizar la época en curso.

`202 Accepted` (trabajo en cola, cancelado al instante):

```json
{
  "message": "Trabajo cancelado antes de iniciar.",
  "status": "CANCELLED",
  "cancel_requested": true
}
```

`202 Accepted` (trabajo en ejecución, cancelación pendiente):

```json
{
  "message": "Solicitud de cancelación registrada. El worker confirmará el estado final.",
  "status": "RUNNING",
  "cancel_requested": true
}
```

- `409` si el job ya está `COMPLETED`, `FAILED` o `CANCELLED`.
- Si la notificación al worker falla, la solicitud queda persistida y el worker
  la aplica al reconectar.

---

## 7. Eventos en tiempo real

### SSE

El JWT **no** se envía en la URL. Primero se solicita un ticket de un solo uso
(autenticado con `Authorization: Bearer`):

`POST /api/v1/training-jobs/{job_id}/events-ticket`

```json
{
  "ticket": "u7Y...",
  "expires_in": 30
}
```

Después:

`GET /api/v1/training-jobs/{job_id}/events?ticket=<ticket>`

El ticket caduca a los 30 segundos (configurable con `STREAM_TICKET_TTL_SECONDS`)
y se invalida al primer uso. También se admite `Authorization: Bearer` sin ticket.
Respuesta `text/event-stream` con `Cache-Control: no-cache` y `X-Accel-Buffering: no`.

Formato:

```
event: snapshot
data: {...}

event: epoch_end
data: {...}
```

### WebSocket

`WS /api/v1/training-jobs/{job_id}/events/ws?ticket=<ticket>`

El ticket se obtiene con el mismo `POST .../events-ticket`. Mismo conjunto de eventos como objetos JSON. Códigos de cierre: `4401` no autorizado, `4404` job inexistente, `4400` error inesperado.

### Tipos de evento

**`snapshot`** — siempre el primero; reconstruye el estado desde PostgreSQL:

```json
{
  "event": "snapshot",
  "job": {
    "id": "7b89...",
    "project_id": "4d3f...",
    "status": "RUNNING",
    "progress": 24.0,
    "cancel_requested": false,
    "error_message": null,
    "started_at": "2026-11-01T15:30:10Z",
    "ended_at": null,
    "metrics_history": [
      { "epoch": 1, "loss": 0.67, "accuracy": 0.74 }
    ]
  }
}
```

**`epoch_end`** — publicado por el worker en Redis:

```json
{
  "event": "epoch_end",
  "job_id": "7b89...",
  "epoch": 12,
  "total_epochs": 50,
  "progress": 24.0,
  "metrics": {
    "loss": 0.3421,
    "accuracy": 0.885,
    "val_loss": 0.361,
    "val_accuracy": 0.871
  }
}
```

**`metrics`** — épocas recuperadas por sondeo de la base de datos:

```json
{
  "event": "metrics",
  "job_id": "7b89...",
  "status": "RUNNING",
  "progress": 26.0,
  "metrics": [ { "epoch": 13, "loss": 0.33, "accuracy": 0.89 } ]
}
```

**`state`** — cambio de estado o estado terminal:

```json
{
  "event": "state",
  "job_id": "7b89...",
  "status": "COMPLETED",
  "progress": 100.0,
  "error_message": null,
  "metrics_history": [ { "epoch": 50, "loss": 0.12, "accuracy": 0.97 } ]
}
```

**`error`**:

```json
{ "event": "error", "detail": "Trabajo no encontrado" }
```

Semántica de recuperación: el stream emite el `snapshot`, escucha Pub/Sub y, en paralelo, consulta la base de datos. Si Redis no está disponible o se pierde la conexión, las épocas y estados faltantes se emiten como `metrics`/`state` desde PostgreSQL. Al alcanzar un estado terminal, el stream emite un último `state` y cierra.

Canales:

- Eventos: `neurolab:job:{job_id}:events`
- Control de cancelación: `neurolab:job:{job_id}:control` con `{"action":"CANCEL"}`
- Clave de cancelación: `neurolab:job:{job_id}:cancel` (TTL 1 hora)

En modo `QUEUE_BACKEND=filesystem` la cancelación usa `DATA_DIR/cancellations/{job_id}.flag` y la API sigue recuperando el estado por sondeo de la base de datos.

---

## 8. Registro de modelos (`/models`)

### `GET /projects/{project_id}/models`

`200 OK` → lista de `ModelVersionResponse`:

```json
{
  "id": "a1b2...",
  "project_id": "4d3f...",
  "job_id": "7b89...",
  "version": "v1.0",
  "storage_key": "models/4d3f.../7b89.../model.keras",
  "status": "DRAFT",
  "checksum": "9f86d081884c7d659a2feaa0c55ad015...",
  "metrics_summary": {
    "test_loss": 0.184,
    "test_accuracy": 0.942,
    "accuracy": 0.942,
    "precision": 0.94,
    "recall": 0.94,
    "f1_score": 0.94,
    "roc_auc": 0.9918,
    "pr_auc": 0.9731,
    "balanced_accuracy": 0.93,
    "decision_threshold": 0.55,
    "confusion_matrix": [[10, 1], [0, 19]],
    "class_labels": ["0", "1"],
    "samples_test": 30,
    "task": "classification",
    "epochs_completed": 50,
    "dataset_checksum": "e3b0...",
    "dataset_version": "v1.0",
    "code_version": "1.0.0",
    "class_weights": { "0": 0.672, "1": 1.9535 },
    "baseline_comparison": {
      "available": true,
      "metric": "f1_score",
      "model_score": 0.94,
      "best_baseline": "logistic_regression",
      "best_baseline_score": 0.857,
      "delta": 0.083,
      "beats_baseline": true
    },
    "training": {
      "epochs_completed": 50,
      "early_stopped": false,
      "best_epoch": 48,
      "duration_seconds": 41.2
    },
    "reproducibility": {
      "random_seed": 42,
      "deterministic_ops": true,
      "python_hash_seed": null
    },
    "environment": {
      "python": "3.13.6",
      "packages": { "tensorflow": "2.21.0", "scikit-learn": "1.9.0" },
      "git_commit": "5131244"
    },
    "input_schema": [
      {
        "name": "edad",
        "kind": "numeric",
        "nullable": false,
        "min": 18,
        "max": 80,
        "median": 41
      },
      {
        "name": "ciudad",
        "kind": "categorical",
        "nullable": false,
        "values": ["Lima", "Cusco"],
        "truncated": false
      }
    ],
    "feature_columns": ["edad", "ingreso", "ciudad"],
    "model_card": "model_card.md",
    "artifacts": {
      "model": { "path": "models/.../model.keras", "sha256": "..." },
      "scaler": { "path": "models/.../scaler.pkl", "sha256": "..." },
      "preprocessor": { "path": "models/.../preprocessor.pkl", "sha256": "..." },
      "manifest": { "path": "models/.../training_manifest.json", "sha256": "..." },
      "model_card": { "path": "models/.../model_card.md", "sha256": "..." }
    }
  },
  "created_at": "2026-11-01T15:45:00Z"
}
```

Para regresión, `metrics_summary` incluye `test_loss`, `test_mse`, `test_rmse`, `test_mae` y `r2_score`.

El detalle completo —baselines, brecha de generalización, descripción del
dataset y checksums— está en el manifiesto (`GET /models/{id}/manifest`) y en la
ficha (`GET /models/{id}/card`).

### `GET /models/{model_id}`

`200 OK` → `ModelVersionResponse`; `404` si no existe; `404` si no hay acceso al proyecto.

### `PATCH /models/{model_id}/status`

Roles de escritura para transiciones a `REVIEWED`; `ADMIN` o `PROJECT_LEAD` para `APPROVED` y `RETIRED`.

```json
{ "status": "REVIEWED", "reason": "Métricas revisadas" }
```

Transiciones permitidas:

```
DRAFT     → REVIEWED | RETIRED
REVIEWED  → APPROVED | RETIRED
APPROVED  → RETIRED
RETIRED   → (ninguna)
```

- `409` si la transición no está permitida.
- Si el estado enviado es el actual, devuelve el modelo sin cambios.
- Audita `MODEL_{NUEVO_ESTADO}` con estado anterior y motivo.

### `GET /models/{model_id}/download`

- Requiere acceso al proyecto.
- `200 OK` → `FileResponse` con nombre `model_{version}.keras`.
- `404` si el artefacto no existe en el nodo de almacenamiento.
- `400` si la ruta almacenada escapa de `MODEL_DIR`.

### `POST /models/{model_id}/predict`

Inferencia real sobre el modelo entrenado. Requiere acceso al proyecto y que la
API tenga instaladas las dependencias opcionales (`requirements-inference.txt`).
Carga `model.keras` y `scaler.pkl` del almacenamiento y aplica el mismo
preprocesador del entrenamiento.

```json
{
  "records": [
    { "edad": 30, "ingreso": 40000, "ciudad": "Lima" },
    { "edad": 55, "ingreso": 90000, "ciudad": "Cusco" }
  ],
  "threshold": 0.55
}
```

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `records` | array de objetos | Sí | 1–1000 registros con las columnas del entrenamiento |
| `threshold` | número 0–1 | No | Sólo clasificación binaria; por defecto usa el umbral ajustado |

`200 OK`:

```json
{
  "model_id": "a1b2...",
  "model_version": "v1.0",
  "model_status": "APPROVED",
  "task": "classification",
  "target_column": "abandono",
  "class_labels": ["0", "1"],
  "decision_threshold": 0.55,
  "predictions": [
    {
      "index": 0,
      "prediction": "1",
      "label": "1",
      "probability": 0.88,
      "probabilities": { "0": 0.12, "1": 0.88 },
      "threshold": 0.55
    }
  ],
  "warnings": []
}
```

- Clasificación multiclase: `probabilities` incluye todas las clases y
  `threshold` es `null`.
- Regresión: `prediction` es un número, `label` y `probability` pueden ser
  `null`.
- `warnings` incluye categorías no observadas durante el entrenamiento. No es
  un error: el codificador las trata como categoría nueva.

Errores específicos:

| Código | Causa |
|---|---|
| `404` | Modelo inexistente, sin acceso al proyecto o artefactos no disponibles |
| `409` | Modelo `RETIRED`; o modelo no `APPROVED` con `INFERENCE_REQUIRE_APPROVED=true` |
| `422` | Campos desconocidos o faltantes, valor no numérico/no finito, umbral en multiclase/regresión |
| `503` | Faltan TensorFlow o scikit-learn en la API |

Cada predicción audita `MODEL_PREDICTED` con `model_id`, `version`, número de
registros, tarea y umbral. **No** se persisten los datos de entrada.

### `GET /models/{model_id}/card`

- Requiere acceso al proyecto.
- `200 OK` → `text/markdown; charset=utf-8` con la ficha del modelo.
- `404` si la versión no tiene `model_card.md`.
- No requiere TensorFlow.

### `GET /models/{model_id}/manifest`

- Requiere acceso al proyecto.
- `200 OK` → manifiesto JSON (`schema_version 2`) con entorno, dataset,
  baselines, métricas, hiperparámetros y checksums.
- `404` si la versión no tiene `training_manifest.json`.
- No requiere TensorFlow.

---

## 9. Auditoría (`/projects/{project_id}/audit-events`)

`GET /api/v1/projects/{project_id}/audit-events?action=TRAINING_JOB_COMPLETED&limit=100`

- `action`: filtro opcional.
- `limit`: 1–500, por defecto 100.
- Requiere acceso al proyecto.

`200 OK`:

```json
[
  {
    "id": "b7c1...",
    "actor_id": "c138...",
    "actor_name": "Administrador NeuroLab",
    "project_id": "4d3f...",
    "action": "TRAINING_JOB_COMPLETED",
    "metadata_json": {
      "job_id": "7b89...",
      "model_version": "v1.0",
      "checksum": "9f86...",
      "metrics": { "test_accuracy": 0.942 }
    },
    "created_at": "2026-11-01T15:45:00Z"
  }
]
```

Acciones registradas incluyen: `USER_LOGIN`, `USER_PASSWORD_CHANGED`, `PROJECT_CREATED`, `PROJECT_UPDATED`, `PROJECT_MEMBER_UPSERTED`, `PROJECT_MEMBER_REMOVED`, `DATASET_UPLOADED`, `DATASET_DELETED`, `ARCHITECTURE_CREATED`, `TRAINING_JOB_QUEUED`, `TRAINING_JOB_ENQUEUE_FAILED`, `TRAINING_JOB_CANCEL_REQUESTED`, `TRAINING_JOB_CANCELLED`, `TRAINING_JOB_COMPLETED`, `TRAINING_JOB_FAILED`, `MODEL_REVIEWED`, `MODEL_APPROVED`, `MODEL_RETIRED`, `MODEL_PREDICTED`, `USER_CREATED`, `USER_UPDATED`.

---

## 10. Administración (`/admin`)

Todos los endpoints requieren rol global `ADMIN`.

### `GET /admin/users`

`200 OK` → lista de `UserResponse` ordenada por creación.

### `POST /admin/users`

```json
{
  "email": "engineer@empresa.com",
  "password": "User123!",
  "display_name": "Ingeniero IA",
  "role": "AI_ENGINEER"
}
```

- Contraseña: 8–128 caracteres; `display_name`: 2–150.
- `201 Created` → `UserResponse`.
- `409` si el correo ya existe.
- Audita `USER_CREATED`.

### `PATCH /admin/users/{user_id}`

```json
{ "display_name": "Nuevo Nombre", "role": "REVIEWER", "status": "ACTIVE" }
```

- `status`: `ACTIVE`, `INACTIVE` o `SUSPENDED`.
- `400` si un administrador intenta desactivar su propia cuenta.
- Audita `USER_UPDATED`.

### `GET /admin/system`

```json
{
  "status": "healthy",
  "environment": "development",
  "version": "1.0.0",
  "database": "up",
  "redis": "up",
  "queue_backend": "redis",
  "limits": {
    "max_upload_mb": 50,
    "max_csv_rows": 500000,
    "max_csv_columns": 500,
    "token_expire_minutes": 480
  },
  "uptime_seconds": 1234.56
}
```

- `status` es `degraded` si la base de datos no responde.
- `redis` refleja el resultado del `PING`; en modo filesystem puede ser `down` sin afectar la operación.

---

## 11. Fundamentos (`/fundamentals`)

`GET /api/v1/fundamentals` — público. Devuelve:

- `module`, `concepts` (neurona, activaciones) y `families` (`FEEDFORWARD`, `RNN`, `CNN`, `GAN`) con descripción, casos de uso y capas estándar.

---

## 12. Enumeraciones y reglas compartidas

- **Estados de job:** `QUEUED`, `PREPARING`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED`.
- **Estados de modelo:** `DRAFT`, `REVIEWED`, `APPROVED`, `RETIRED`.
- **Roles:** `ADMIN`, `PROJECT_LEAD`, `AI_ENGINEER`, `REVIEWER`, `VIEWER`.
- **Roles de escritura:** `ADMIN`, `PROJECT_LEAD`, `AI_ENGINEER`.
- **Roles de aprobación:** `ADMIN`, `PROJECT_LEAD`, `REVIEWER`.
- **Tareas:** `classification`, `regression`.
- **Familias:** `FEEDFORWARD`, `RNN`, `CNN`, `GAN` (entrenamiento real para FEEDFORWARD/RNN/CNN; GAN es conceptual).
- **Fechas:** ISO 8601 con zona horaria (UTC).
- **IDs:** UUID v4.
- **Snake_case** en todas las respuestas. El frontend normaliza a camelCase.
