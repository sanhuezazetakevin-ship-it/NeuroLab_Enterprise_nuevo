"""Construcción del manifiesto de entrenamiento y de la ficha del modelo.

El manifiesto es el contrato de trazabilidad del experimento: permite responder
quién entrenó qué, con qué datos, con qué código y con qué resultado. Se escribe
junto a los artefactos (``training_manifest.json``) y la ficha legible
(``model_card.md``) para que ambos viajen con el modelo.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional
from uuid import UUID

from baselines import describe_dataset

SCHEMA_VERSION = 2


def build_manifest(
    *,
    project_id: UUID,
    job_id: UUID,
    data,
    hyperparameters: Dict[str, Any],
    architecture: Dict[str, Any],
    dataset: Dict[str, Any],
    evaluation: Dict[str, Any],
    baseline_report: Dict[str, Any],
    comparison: Dict[str, Any],
    generalization: Dict[str, Any],
    environment: Dict[str, Any],
    reproducibility: Dict[str, Any],
    training_summary: Dict[str, Any],
    artifacts: Dict[str, Any],
    code_version: str,
    dataset_filename: Optional[str] = None,
) -> Dict[str, Any]:
    """Devuelve el manifiesto completo del experimento."""
    return {
        "schema_version": SCHEMA_VERSION,
        "code_version": code_version,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "project_id": str(project_id),
        "job_id": str(job_id),
        "model_version": None,  # lo asigna el registro; se completa al publicar
        # --------------------------------------------------------------
        # Datos
        # --------------------------------------------------------------
        "dataset": {
            "id": str(dataset.get("id") or ""),
            "name": dataset.get("name"),
            "version": dataset.get("version"),
            "filename": dataset_filename or dataset.get("original_filename"),
            "checksum": dataset.get("checksum"),
            "target_column": data.target_column,
            **describe_dataset(data),
        },
        # --------------------------------------------------------------
        # Arquitectura
        # --------------------------------------------------------------
        "architecture": {
            "family": (architecture.get("family") or "").upper(),
            "name": architecture.get("name"),
            "config": architecture.get("config_json") or {},
            "input_dim": int(data.input_dim),
            "output_units": int(data.output_units),
            "output_activation": data.output_activation,
            "loss": data.loss,
            "feature_names": list(data.feature_names),
            "input_schema": list(getattr(data, "input_schema", [])),
        },
        # --------------------------------------------------------------
        # Entrenamiento
        # --------------------------------------------------------------
        "training": {
            "hyperparameters": hyperparameters,
            "epochs_requested": int(hyperparameters.get("epochs", 0) or 0),
            **training_summary,
        },
        "reproducibility": reproducibility,
        "environment": environment,
        # --------------------------------------------------------------
        # Evaluación
        # --------------------------------------------------------------
        "evaluation_protocol": {
            "holdout": "train / validation / test disjuntos",
            "validation_split": float(getattr(data, "val_split", 0.0) or 0.0),
            "test_split": float(getattr(data, "test_split", 0.0) or 0.0),
            "stratified": bool(getattr(data, "stratified", False)),
            "test_samples": int(data.samples_test),
            "metric_source": "conjunto de prueba reservado, no usado en entrenamiento",
            "threshold_selection": "maximización de F1 sobre el conjunto de prueba"
            if data.task == "classification"
            else None,
        },
        "metrics": evaluation,
        "baselines": baseline_report,
        "baseline_comparison": comparison,
        "generalization": generalization,
        "artifacts": artifacts,
    }


def _format_value(value: Any) -> str:
    if value is None:
        return "—"
    if isinstance(value, float):
        return f"{value:.4f}"
    return str(value)


def _format_percent(value: Any) -> str:
    if value is None:
        return "—"
    try:
        return f"{float(value) * 100:.2f}%"
    except (TypeError, ValueError):
        return str(value)


def render_model_card(manifest: Dict[str, Any]) -> str:
    """Genera la ficha del modelo en Markdown a partir del manifiesto."""
    dataset = manifest.get("dataset", {})
    architecture = manifest.get("architecture", {})
    training = manifest.get("training", {})
    metrics = manifest.get("metrics", {})
    comparison = manifest.get("baseline_comparison", {})
    generalization = manifest.get("generalization", {})
    environment = manifest.get("environment", {})
    reproducibility = manifest.get("reproducibility", {})
    protocol = manifest.get("evaluation_protocol", {})

    task = metrics.get("task", dataset.get("task", "desconocida"))
    task_label = {
        "classification": "clasificación",
        "regression": "regresión",
    }.get(task, task)
    lines: list[str] = []
    add = lines.append

    add("# Ficha del modelo (Model Card)")
    add("")
    add(f"**Proyecto:** `{manifest.get('project_id')}`  ")
    add(f"**Trabajo de entrenamiento:** `{manifest.get('job_id')}`  ")
    add(f"**Versión del modelo:** `{manifest.get('model_version') or 'pendiente de registro'}`  ")
    add(f"**Generada:** {manifest.get('created_at')}  ")
    add(f"**Versión del código:** `{manifest.get('code_version')}`")
    add("")

    add("## 1. Uso previsto")
    add("")
    add(
        f"Modelo supervisado de **{task_label}** entrenado sobre datos tabulares del "
        f"dataset `{dataset.get('name') or dataset.get('filename') or 'sin nombre'}`."
    )
    add("")
    add(
        "Uso previsto: apoyo a la decisión sobre datos con la misma estructura y "
        "distribución que el conjunto de entrenamiento. No debe usarse como único "
        "criterio en decisiones que afecten a personas sin revisión humana."
    )
    add("")

    add("## 2. Datos")
    add("")
    add("| Elemento | Valor |")
    add("|---|---|")
    add(f"| Filas totales | {_format_value(dataset.get('total_rows'))} |")
    add(f"| Entrenamiento | {_format_value(dataset.get('train_rows'))} |")
    add(f"| Validación | {_format_value(dataset.get('validation_rows'))} |")
    add(f"| Prueba | {_format_value(dataset.get('test_rows'))} |")
    add(f"| Columnas objetivo | {_format_value(dataset.get('target_column'))} |")
    add(f"| Características de entrada | {_format_value(dataset.get('features_input'))} |")
    add(f"| Filas duplicadas | {_format_value(dataset.get('duplicate_rows'))} |")
    add(f"| Checksum del dataset | `{dataset.get('checksum') or '—'}` |")
    add("")
    if dataset.get("class_distribution"):
        add("**Distribución de clases en entrenamiento:**")
        add("")
        add("| Clase | Filas | Peso aplicado |")
        add("|---|---|---|")
        weights = dataset.get("class_weights") or {}
        for label, count in dataset["class_distribution"].items():
            add(f"| {label} | {count} | {_format_value(weights.get(str(label)))} |")
        add("")
    if dataset.get("class_balance_warning"):
        add(f"> **Advertencia de datos:** {dataset['class_balance_warning']}")
        add("")

    add("## 3. Arquitectura")
    add("")
    add(f"- Familia: `{architecture.get('family')}`")
    add(f"- Nombre: `{architecture.get('name') or 'sin nombre'}`")
    add(f"- Entrada: `{architecture.get('input_dim')}` características")
    add(f"- Salida: `{architecture.get('output_units')}` unidad(es), activación `{architecture.get('output_activation')}`")
    add(f"- Pérdida: `{architecture.get('loss')}`")
    add("")
    layers = (architecture.get("config") or {}).get("layers") or []
    if layers:
        add("| # | Capa | Configuración |")
        add("|---|---|---|")
        for index, layer in enumerate(layers, start=1):
            config = ", ".join(
                f"{key}={value}"
                for key, value in layer.items()
                if key not in {"type", "id"} and value is not None
            )
            add(f"| {index} | {layer.get('type', '—')} | {config or '—'} |")
        add("")

    add("## 4. Entrenamiento")
    add("")
    add("| Parámetro | Valor |")
    add("|---|---|")
    hyperparameters = training.get("hyperparameters") or {}
    for key in (
        "epochs",
        "batch_size",
        "optimizer",
        "learning_rate",
        "validation_split",
        "random_seed",
    ):
        if key in hyperparameters:
            add(f"| {key} | {_format_value(hyperparameters[key])} |")
    for key in ("epochs_completed", "early_stopped", "best_epoch", "duration_seconds"):
        if key in training:
            add(f"| {key} | {_format_value(training[key])} |")
    add("")

    add("## 5. Evaluación")
    add("")
    add(
        f"Medición sobre **{protocol.get('test_samples', '—')}** muestras de prueba "
        "no utilizadas durante el entrenamiento"
        + (" (partición estratificada)." if protocol.get("stratified") else ".")
    )
    add("")
    add("| Métrica | Valor |")
    add("|---|---|")
    if task == "classification":
        add(f"| Accuracy | {_format_percent(metrics.get('accuracy'))} |")
        add(f"| Balanced accuracy | {_format_percent(metrics.get('balanced_accuracy'))} |")
        add(f"| Precision (clase positiva) | {_format_percent(metrics.get('precision'))} |")
        add(f"| Recall (clase positiva) | {_format_percent(metrics.get('recall'))} |")
        add(f"| F1 | {_format_percent(metrics.get('f1_score'))} |")
        add(f"| ROC-AUC | {_format_value(metrics.get('roc_auc'))} |")
        add(f"| PR-AUC | {_format_value(metrics.get('pr_auc'))} |")
        add(f"| Umbral de decisión | {_format_value(metrics.get('decision_threshold'))} |")
        add(f"| Pérdida (test) | {_format_value(metrics.get('test_loss'))} |")
    else:
        add(f"| RMSE | {_format_value(metrics.get('test_rmse'))} |")
        add(f"| MAE | {_format_value(metrics.get('test_mae'))} |")
        add(f"| R² | {_format_value(metrics.get('r2_score'))} |")
        add(f"| MAPE | {_format_value(metrics.get('test_mape'))} |")
        add(f"| Pérdida (test) | {_format_value(metrics.get('test_loss'))} |")
    add("")

    if task == "classification" and metrics.get("per_class"):
        add("**Detalle por clase:**")
        add("")
        add("| Clase | Precision | Recall | F1 | Soporte |")
        add("|---|---|---|---|---|")
        for label, values in metrics["per_class"].items():
            add(
                f"| {label} | {_format_percent(values.get('precision'))} | "
                f"{_format_percent(values.get('recall'))} | "
                f"{_format_value(values.get('f1_score'))} | {values.get('support')} |"
            )
        add("")

    add("## 6. Comparación con baselines")
    add("")
    if comparison.get("available"):
        verdict = "sí" if comparison.get("beats_baseline") else "no"
        add(
            f"El modelo **{verdict}** supera al mejor baseline "
            f"(`{comparison.get('best_baseline')}`) en `{comparison.get('metric')}`."
        )
        add("")
        add("| Modelo | " + str(comparison.get("metric")) + " |")
        add("|---|---|")
        add(f"| Red neuronal | {_format_value(comparison.get('model_score'))} |")
        add(
            f"| Mejor baseline ({comparison.get('best_baseline')}) | "
            f"{_format_value(comparison.get('best_baseline_score'))} |"
        )
        add("")
        if not comparison.get("beats_baseline"):
            add(
                "> **Interpretación:** con los datos disponibles, un modelo lineal "
                "iguala o supera a la red. La complejidad adicional no está "
                "justificada todavía; conviene revisar características, "
                "hiperparámetros o el tamaño del dataset."
            )
            add("")
    else:
        add("No fue posible comparar con baselines para este experimento.")
        add("")

    add("## 7. Generalización")
    add("")
    if generalization.get("available"):
        add(
            f"Diagnóstico: **{generalization.get('verdict')}**. "
            f"Degradación de la pérdida de validación: "
            f"{_format_value(generalization.get('validation_degradation_pct'))}%. "
            f"Mejor época: {generalization.get('best_epoch')}."
        )
    else:
        add("No hay historial suficiente para diagnosticar sobreajuste.")
    add("")

    add("## 8. Reproducibilidad")
    add("")
    add(f"- Semilla: `{reproducibility.get('random_seed')}`")
    add(f"- Determinismo de operaciones: `{reproducibility.get('deterministic_ops')}`")
    add(f"- `PYTHONHASHSEED`: `{reproducibility.get('python_hash_seed')}`")
    add("")
    add("```bash")
    add("cd workers/training")
    add(f"python worker.py --job-id {manifest.get('job_id')}")
    add("```")
    add("")
    add("Versiones del entorno:")
    add("")
    add("| Componente | Versión |")
    add("|---|---|")
    add(f"| Python | {environment.get('python')} |")
    for name, version in (environment.get("packages") or {}).items():
        add(f"| {name} | {version} |")
    add("")

    add("## 9. Limitaciones")
    add("")
    add(
        "- El modelo solo es válido para la distribución de datos observada; "
        "no hay monitoreo de deriva implementado."
    )
    add(
        "- Las métricas provienen de un único split. En datasets pequeños la "
        "varianza entre particiones puede ser alta."
    )
    add(
        "- La explicabilidad es limitada: no se calculan importancias de "
        "características ni valores SHAP."
    )
    if task == "classification":
        add(
            "- El umbral de decisión se ajustó maximizando F1 sobre el conjunto "
            "de prueba; en producción debe recalibrarse con datos independientes."
        )
    add("")

    add("## 10. Trazabilidad")
    add("")
    add("| Artefacto | Archivo |")
    add("|---|---|")
    for name, filename in (manifest.get("artifacts") or {}).items():
        add(f"| {name} | `{filename}` |")
    add("")
    return "\n".join(lines) + "\n"
