# Guía de pruebas personal — NeuroLab Enterprise

Esta guía es para que **tú mismo** verifiques el sistema punto por punto antes de
presentarlo. Cada prueba tiene: qué hacer, qué debes ver y cuándo se considera
aprobada. Marca las casillas a medida que avanzas.

> **Regla de oro:** prueba siempre sobre la instancia demo aislada. Usa SQLite
> temporal en `%TEMP%\neurolab_demo`; no toca Supabase ni tus datos reales.

---

## 0. Antes de empezar

| Requisito | Cómo comprobarlo |
|---|---|
| Python 3.13 con TensorFlow instalado | `python -c "import tensorflow as tf; print(tf.__version__)"` |
| Node.js y npm | `node -v` y `npm.cmd -v` |
| Puertos libres | `Get-NetTCPConnection -State Listen -LocalPort 8010,5183` no debe devolver nada |
| Carpeta del proyecto | `C:\Users\sanhu\Desktop\NeuroLab_Enterprise` |

**Credenciales de la demo**

| Rol | Correo | Contraseña |
|---|---|---|
| ADMIN | `admin@neurolab.enterprise` | `Admin123!` |
| REVIEWER | `revisor@instituto.edu` | `Revisor123!` |

**URLs de la demo**

| Recurso | URL |
|---|---|
| Aplicación | http://127.0.0.1:5183 |
| API | http://127.0.0.1:8010 |
| Swagger | http://127.0.0.1:8010/api/v1/docs |
| Health | http://127.0.0.1:8010/health |

---

## 1. Preparación (10–15 min la primera vez)

### P0.1 — Arranque limpio

```powershell
cd C:\Users\sanhu\Desktop\NeuroLab_Enterprise
powershell -ExecutionPolicy Bypass -File scripts/start_demo.ps1 -Fresh -ApiPort 8010 -WebPort 5183
```

- [ ] La consola termina con **«Listo para la exposicion»**.
- [ ] Se creó `%TEMP%\neurolab_demo\demo.db`.
- [ ] Se creó `%TEMP%\neurolab_demo\demo_ids.json`.

> El script entrena un modelo real (v1.0), lo deja aprobado y encola un segundo
> entrenamiento. Puede tardar 1–3 minutos.

### P0.2 — Salud de los servicios

```powershell
Invoke-RestMethod http://127.0.0.1:8010/health | ConvertTo-Json
Invoke-WebRequest http://127.0.0.1:5183 -UseBasicParsing | Select-Object StatusCode
```

- [ ] `/health` responde `status: healthy`.
- [ ] La web responde `200`.

### P0.3 — Documentación de API

Abre http://127.0.0.1:8010/api/v1/docs.

- [ ] Swagger carga y lista los endpoints de auth, proyectos, datasets,
      arquitecturas, entrenamientos, modelos y reportes.

---

## 2. Pruebas de acceso y roles

### P1.1 — Login correcto

1. Abre http://127.0.0.1:5183.
2. Entra con `admin@neurolab.enterprise` / `Admin123!`.

- [ ] Entra al panel sin errores.
- [ ] Arriba se lee el proyecto **Predicción de Abandono de Clientes** y el rol
      **ADMINISTRADOR**.
- [ ] El botón de mostrar/ocultar contraseña funciona.

### P1.2 — Login incorrecto

1. Cierra sesión o abre una ventana privada.
2. Escribe la contraseña `incorrecta`.

- [ ] No entra.
- [ ] Aparece un mensaje de error visible con `role="alert"`.
- [ ] No se revela si el correo existe o no.

### P1.3 — Rol REVIEWER (RBAC)

1. Cierra sesión e inicia con `revisor@instituto.edu` / `Revisor123!`.
2. Entra a **Entrenamientos**.
3. Intenta iniciar un entrenamiento y cancelar uno.

- [ ] Ve el historial y las métricas.
- [ ] **No** puede iniciar ni cancelar entrenamientos (botones deshabilitados o
      aviso de rol).
- [ ] **No** ve la sección **Administración** en el menú.

### P1.4 — Token obligatorio

En PowerShell, sin token:

```powershell
Invoke-RestMethod http://127.0.0.1:8010/api/v1/projects
```

- [ ] La API responde `401 Unauthorized`.
- [ ] Con un token válido (login) responde `200`.

---

## 3. Proyecto, datos y arquitectura

### P2.1 — Panel general

Abre **Panel general**.

- [ ] Se ven contadores de arquitecturas, datasets, entrenamientos y versiones.
- [ ] Se ven los trabajos recientes con su estado (`Completado`, `En cola`).
- [ ] Se ve el estado de la plataforma (base de datos, cola).
- [ ] No hay cifras en cero ni textos de maqueta.

### P2.2 — Proyecto

Abre **Proyectos**.

- [ ] Aparece el proyecto con su rol, estado y contadores.
- [ ] El selector de proyecto cambia el contexto global.

### P2.3 — Conjunto de datos

Abre **Conjuntos de datos**.

- [ ] El dataset **Clientes del instituto** está verificado.
- [ ] Muestra **600 filas** y **9 características**.
- [ ] Muestra la columna objetivo `abandono`.
- [ ] Muestra un checksum SHA-256 de 64 caracteres.
- [ ] La vista previa de filas y tipos es coherente.

### P2.4 — Arquitectura

Abre **Diseñador de redes**.

- [ ] Se ven al menos dos arquitecturas guardadas.
- [ ] La **MLP de referencia** y la **MLP profunda** muestran sus capas.
- [ ] El resumen indica 9 entradas, salida `1` con `sigmoid` y el total de
      parámetros.
- [ ] La validación del servidor responde **«Topología válida»**.

### P2.5 — Fundamentos (opcional, valor académico)

Abre **Fundamentos**.

- [ ] El simulador del perceptrón cambia la frontera al mover pesos o sesgo.
- [ ] Se ven combinación lineal, activación y gradiente.
- [ ] El checkpoint responde y explica el resultado.

---

## 4. Entrenamiento real (el núcleo)

### P3.1 — Encolar un trabajo desde la interfaz

1. Abre **Entrenamientos**.
2. En **Configuración del nuevo trabajo** elige:
   - Arquitectura: `MLP profunda (entrenamiento en vivo)`
   - Conjunto de datos: `Clientes del instituto`
   - Columna objetivo: `abandono` (se autocompleta)
   - Tipo de tarea: `classification` (se autocompleta)
   - Épocas: **20**
   - Tamaño de lote: **32**
   - Optimizador: **Adam**
   - Tasa de aprendizaje: **0.001**
3. Pulsa **Iniciar Entrenamiento**.

- [ ] Aparece un toast «Trabajo encolado».
- [ ] El panel del trabajo muestra **En cola**, **0 %**, **0 / 20**.
- [ ] El trabajo nuevo aparece primero en el historial.

### P3.2 — Procesar con el worker persistente

`scripts/start_demo.ps1` arranca un **worker persistente precalentado** (salvo
que se use `-NoWorker`). El worker importa TensorFlow una sola vez y queda
escuchando la cola, por lo que el trabajo pasa de **En cola** a **En ejecución**
en menos de un segundo.

- [ ] No hace falta abrir otra terminal: el trabajo empieza solo.
- [ ] El log `%TEMP%\neurolab_demo\worker.err.log` muestra `QUEUED -> PREPARING`.
- [ ] Muestra `Dataset preparado: 600 filas, 9 características`.
- [ ] Muestra `Modelo Keras compilado` con el número de parámetros.
- [ ] Termina con `COMPLETED` y una versión nueva (`v1.x`).
- [ ] Se guardó `model.keras` con un SHA-256.

> **Modo manual (opcional).** Si arrancaste con `-NoWorker`, procesa el trabajo
> con `scripts/run_worker_once.ps1 -JobId <UUID>`. Ese modo paga ~20 s de
> importación de TensorFlow en cada ejecución; el worker persistente no.

### P3.3 — Telemetría en pantalla

Sin recargar la página, observa **Entrenamientos** mientras corre.

- [ ] El estado cambia a **En ejecución**.
- [ ] La época avanza (`n / 20`).
- [ ] Las curvas de pérdida y exactitud se dibujan.
- [ ] Se ven velocidad por época y tiempo restante estimado.
- [ ] Al terminar: **Completado**, **100 %**, `20 / 20`.
- [ ] Aparecen métricas finales y la marca de mejor época.

### P3.4 — Cancelación (opcional)

Pruebe los dos escenarios:

**a) Trabajo en cola (sin worker activo)**

1. Encola un trabajo y **no** arranques el worker.
2. Pulsa **Cancelar trabajo** y confirma.

- [ ] La interfaz pide confirmación.
- [ ] El estado pasa a **Cancelado** de inmediato, sin quedar «En cola» ni girando.
- [ ] El botón de cancelar desaparece y ya puede encolar otro trabajo.

**b) Trabajo en ejecución**

1. Encola otro trabajo de **100 épocas**.
2. Con el worker persistente ya activo, espera a que empiece.
3. Pulsa **Cancelar trabajo** y confirma.

- [ ] La interfaz pide confirmación.
- [ ] Aparece «Cancelación pendiente» mientras termina la época en curso.
- [ ] El estado refleja la cancelación al finalizar esa época.
- [ ] No se corrompe el historial ni la base.

---

## 5. Evaluación

### P4.1 — Métricas de la versión nueva

Abre **Evaluación y métricas**.

- [ ] La versión evaluada es la más reciente (`v1.x`).
- [ ] Se ven Exactitud, Pérdida, F1 y Precisión/Exhaustividad.
- [ ] La exactitud es coherente (> 70 % en este dataset).
- [ ] Las métricas coinciden con la ficha del modelo.

### P4.2 — Matriz de confusión

- [ ] La matriz es 2×2 (clases 0 y 1).
- [ ] Los aciertos se ven en verde y los errores en rojo.
- [ ] La suma de las cuatro celdas es **90**.
- [ ] Se muestra el total de aciertos, errores y muestras.

### P4.3 — Comparación de versiones

- [ ] La tabla **VERSIONES REGISTRADAS** lista todas las versiones.
- [ ] La de mayor exactitud tiene la insignia **«Mejor métrica»**.
- [ ] Se puede cambiar de versión y sus métricas cambian.
- [ ] Se ve el checksum del artefacto evaluado.

---

## 6. Registro y gobernanza

### P5.1 — Estado inicial

Abre **Registro de modelos**.

- [ ] La versión nueva está en **DRAFT**.
- [ ] Los filtros muestran los conteos correctos por estado.
- [ ] Cada tarjeta muestra job de origen, checksum y métricas.

### P5.2 — Transiciones

1. En la versión nueva pulsa **Revisado**.
2. Luego pulsa **Aprobado**.

- [ ] El estado cambia a **REVIEWED** y aparece un toast.
- [ ] Después cambia a **APPROVED**.
- [ ] El botón **Retirado** solo aparece cuando la transición es válida.
- [ ] No se puede saltar de DRAFT a APPROVED.

### P5.3 — Integridad y artefactos

- [ ] **Copiar Hash** copia 64 caracteres hexadecimales.
- [ ] **Descargar .keras** descarga un archivo no vacío.
- [ ] **Ficha** abre el model card de esa versión.

### P5.4 — RBAC en gobernanza

1. Entra como **REVIEWER** y abre **Registro de modelos**.
2. Intenta aprobar o retirar.

- [ ] Las acciones no permitidas están bloqueadas o muestran aviso de permiso.
- [ ] La transición no se ejecuta en el servidor.

---

## 7. Inferencia real

### P6.1 — Formulario individual

1. En **Registro de modelos**, en la versión aprobada, pulsa **Probar modelo**.
2. Completa:
   - edad: `60`
   - ingreso: `9000`
   - antigüedad: `90`
   - productos: `6`
   - ciudad: `Trujillo`
   - canal: `tienda`
3. Pulsa **Ejecutar predicción**.

- [ ] Devuelve **clase predicha** y **probabilidad**.
- [ ] Muestra el **umbral** usado.
- [ ] La probabilidad cambia al modificar los datos.
- [ ] No hay errores en la consola del navegador.

> En este CSV sintético, el abandono correlaciona con mayor antigüedad y más
> productos. No interpretes el resultado como una regla real de negocio.

### P6.2 — Lote CSV

1. Abre la pestaña **Lote CSV**.
2. Sube un CSV con las mismas columnas del dataset.

- [ ] Devuelve una predicción por fila.
- [ ] Informa errores de columnas o formato con un mensaje claro.

### P6.3 — Integración API

1. Abre la pestaña **Integración API**.
2. Copia el ejemplo `cURL` y ejecútalo en PowerShell.

- [ ] La API responde con la misma clase y probabilidad.
- [ ] Sin token, la API responde `401`.

---

## 8. Ficha técnica y exportaciones

### P7.1 — Ficha de auditoría

Abre **Ficha técnica** y selecciona la versión aprobada.

- [ ] Se ven proyecto, modelo, job de origen y estado.
- [ ] Sección **Topología** con capas y parámetros.
- [ ] Sección **Métricas** con los valores persistidos.
- [ ] Sección **Auditoría** con `TRAINING_JOB_COMPLETED`, `MODEL_REVIEWED` y
      `MODEL_APPROVED`.
- [ ] Se ve el SHA-256 del artefacto.

### P7.2 — Exportaciones

- [ ] **Exportar CSV** descarga un archivo abrible.
- [ ] **Exportar JSON** descarga JSON válido.
- [ ] **Imprimir / PDF** abre la vista de impresión sin romper el diseño.

---

## 9. Administración y auditoría

### P8.1 — Usuarios y RBAC

Abre **Administración** (solo ADMIN).

- [ ] Se listan los usuarios y sus roles.
- [ ] Se ve la matriz de permisos por módulo.
- [ ] Se ve el estado del sistema y los límites configurados.

### P8.2 — Auditoría

- [ ] El registro de auditoría muestra acciones reales con fecha, actor y
      metadata.
- [ ] Las acciones de login, job, revisión y aprobación aparecen en orden.

---

## 10. Seguridad y robustez

### P9.1 — CORS

Desde un origen no permitido (por ejemplo, abriendo la API desde otro puerto),
una llamada `fetch` debe ser bloqueada por el navegador.

- [ ] El origen `http://127.0.0.1:5183` sí está permitido.
- [ ] Un origen no listado no recibe cabecera `Access-Control-Allow-Origin`.

### P9.2 — Rate limit de login

Con el límite de la demo en 10000/min no se dispara. Para probarlo:

1. Reinicia la API con `LOGIN_RATE_LIMIT_PER_MINUTE=5`.
2. Intenta iniciar sesión 6 veces con contraseña incorrecta.

- [ ] A partir del límite, la API responde `429`.
- [ ] El bloqueo es por cuenta/IP según configuración.

### P9.3 — Cabeceras de seguridad

En las herramientas de desarrollo del navegador, revisa la respuesta de la API.

- [ ] Incluye `X-Content-Type-Options: nosniff`.
- [ ] Incluye `X-Frame-Options` o `Content-Security-Policy`.
- [ ] No expone `Server` con versiones sensibles.

### P9.4 — SSE con ticket de un solo uso (avanzado)

- [ ] La telemetría funciona sin poner el JWT en la URL.
- [ ] Reutilizar el ticket de eventos falla.

---

## 11. Experiencia de usuario

### P10.1 — Responsive

1. Abre las herramientas de desarrollo y activa el modo móvil (375 px).

- [ ] La navegación se convierte en menú lateral desplegable.
- [ ] No hay scroll horizontal.
- [ ] Las tarjetas y tablas se leen sin cortes.

### P10.2 — Teclado y accesibilidad

- [ ] Se puede navegar con `Tab` y activar con `Enter`/`Espacio`.
- [ ] El foco es visible en botones y campos.
- [ ] Los formularios tienen etiquetas asociadas.
- [ ] Los errores se anuncian (`role="alert"`).
- [ ] Con `prefers-reduced-motion` no hay animaciones agresivas.

### P10.3 — Temas y estados

- [ ] El cambio **Oscuro/Claro** mantiene contraste legible.
- [ ] Los estados de carga muestran skeletons.
- [ ] Un error de red muestra bloque de error con reintento.
- [ ] Un proyecto vacío muestra un estado vacío útil, no una pantalla en blanco.

### P10.4 — Guía de cliente

Pulsa **Guía de Cliente** (abajo a la izquierda).

- [ ] Recorre los módulos paso a paso.
- [ ] Se puede cerrar y reabrir sin romper la navegación.

---

## 12. Pruebas automáticas

Ejecuta y anota el resultado:

```powershell
cd C:\Users\sanhu\Desktop\NeuroLab_Enterprise\services\api
python -m pytest tests -q

cd C:\Users\sanhu\Desktop\NeuroLab_Enterprise
python -m pytest workers\training\tests -q

python -m ruff check .

cd C:\Users\sanhu\Desktop\NeuroLab_Enterprise\apps\web
npm.cmd run build
```

- [ ] API: todos los tests pasan (0 fallos).
- [ ] Worker: todos los tests pasan (0 fallos).
- [ ] Ruff: sin errores.
- [ ] Build de Vite: termina correctamente (TypeScript + bundle).

> En PowerShell, `npm.cmd run build` puede devolver código 1 por advertir en
> stderr aunque el build haya terminado bien. Revisa la última línea del build.

---

## 13. Criterio de aceptación global

Considera el trabajo **listo para presentar** si:

- [ ] Puedes iniciar sesión con ADMIN y REVIEWER.
- [ ] El RBAC bloquea lo que debe bloquear.
- [ ] Encolas un entrenamiento y el worker lo completa.
- [ ] La telemetría y las curvas se actualizan sin recargar.
- [ ] La evaluación muestra métricas y matriz coherentes.
- [ ] El ciclo DRAFT → REVIEWED → APPROVED funciona y queda auditado.
- [ ] La ficha técnica refleja exactamente las métricas persistidas.
- [ ] La predicción real responde y cambia con los datos.
- [ ] No hay errores en consola ni pantallas en blanco.
- [ ] Tests, lint y build pasan.

---

## 14. Rendimiento medido y optimizaciones

Medición real sobre la demo SQLite (600 filas, 9 características de entrada):

| Operación | Antes | Después |
|---|---|---|
| `GET /admin/system` (Redis ausente) | ~1024 ms constante | 277 ms la primera vez, 10–38 ms en caché |
| Inicio de entrenamiento (`POST`) | ~60 ms | 33–37 ms |
| Espera en cola del primer trabajo | 43,7 s (worker one-shot) | **0,21 s** (worker persistente precalentado) |
| Entrenamiento de 5 épocas + evaluación + artefactos | — | ~5,8 s |
| Listado de trabajos con métricas | 1 consulta por trabajo (N+1) | 1 sola consulta agrupada |
| Bundle inicial del frontend | 1 chunk >500 kB | 264,8 kB + chunks por vista |

Cambios aplicados:

- `SQL_ECHO=false` por defecto; el eco de SQL ya no infla logs ni I/O.
- `GET /admin/system` cachea la salud de Redis 5 s y usa un ping de 250 ms.
- El listado de trabajos carga todas las métricas en una consulta agrupada.
- El worker persistente hace calentamiento (motor de base, Keras y entorno)
  antes de anunciarse como activo, y sondea la cola cada 0,5 s en la demo.
- Las vistas del frontend se cargan con `React.lazy`; React e iconos van en
  chunks separados y cacheables.

Cómo reproducir la medición: arranca la demo, mide `POST` a
`/projects/{id}/training-jobs` y consulta el trabajo hasta `COMPLETED`. La
diferencia entre `created_at` y `started_at` es la espera real en cola.

---

## 15. Problemas comunes

| Síntoma | Causa probable | Solución |
|---|---|---|
| La web no carga | API o Vite caídos | `powershell -ExecutionPolicy Bypass -File scripts/stop_demo.ps1` y volver a arrancar |
| Swagger se ve en blanco | La CSP bloqueaba los assets del CDN (ya corregido) | Recarga `/api/v1/docs`; si persiste, comprueba acceso a `cdn.jsdelivr.net` |
| El job se queda en «En cola» | Worker no está corriendo | Arranca la demo con worker persistente o ejecuta `scripts/run_worker_once.ps1 -JobId <uuid>` |
| El primer entrenamiento tarda unos segundos extra | Worker recién arrancado calentando | El worker persistente paga el calentamiento al inicio; los siguientes jobs arrancan en <1 s |
| El login falla por CORS | Origen no permitido | Arranca la API con `CORS_ORIGINS` que incluya el puerto de la web |
| `SSE en vivo` no actualiza | Redis ausente (normal en demo) | La app usa sondeo a la base; espera unos segundos |
| El worker falla al importar TensorFlow | Entorno incorrecto | Usa el Python del proyecto y `TF_CPP_MIN_LOG_LEVEL=2` |
| El puerto está ocupado | Instancia anterior viva | `scripts/stop_demo.ps1` o cierra el proceso del puerto |
| El entrenamiento tarda mucho | Épocas o dataset grandes | Usa 20 épocas para pruebas |

---

## 16. Registro de resultados

Copia esta tabla y anota fecha, resultado y observaciones:

| Prueba | Fecha | Resultado | Observaciones |
|---|---|---|---|
| P0.1 Arranque | | | |
| P0.2 Salud | | | |
| P1.1 Login ADMIN | | | |
| P1.2 Login incorrecto | | | |
| P1.3 RBAC REVIEWER | | | |
| P2.3 Dataset | | | |
| P2.4 Arquitectura | | | |
| P3.1 Encolar job | | | |
| P3.2 Worker | | | |
| P3.3 Telemetría | | | |
| P4.1 Métricas | | | |
| P4.2 Matriz | | | |
| P5.2 Transiciones | | | |
| P6.1 Predicción | | | |
| P7.1 Ficha | | | |
| P7.2 Exportaciones | | | |
| P8.1 Administración | | | |
| P10.2 Accesibilidad | | | |
| P12 Tests automáticos | | | |

---

## 17. Limpieza

```powershell
# Detener demo
powershell -ExecutionPolicy Bypass -File scripts/stop_demo.ps1

# Borrar datos temporales de la demo (opcional)
Remove-Item -Recurse -Force (Join-Path $env:TEMP "neurolab_demo")
```

- [ ] La demo se detuvo y los puertos quedaron libres.
- [ ] Tus datos reales de Supabase no se modificaron.

---

**Archivos de referencia**

- `docs/DEMO_EXPOSICION.md` — guion de exposición.
- `docs/preview/recorrido-en-vivo.html` — validación visual con capturas.
- `scripts/start_demo.ps1`, `scripts/run_worker_once.ps1`, `scripts/stop_demo.ps1`.
- `README.md` — arquitectura y puesta en marcha.
