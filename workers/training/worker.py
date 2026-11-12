"""Worker de entrenamiento NeuroLab.

Consume trabajos de Redis (producción) o de una cola en el sistema de archivos
(desarrollo local), prepara el CSV, entrena un modelo Keras real, persiste
métricas por época y publica telemetría. La API nunca importa TensorFlow.

Uso:
    python worker.py                 # daemon continuo
    python worker.py --once          # procesa un trabajo y sale
    python worker.py --job-id <uuid> # reconstruye y ejecuta un trabajo concreto
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import signal
import socket
import sys
import time
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional
from uuid import UUID

import worker_db as db
from baselines import compute_baselines, describe_dataset, weights_to_json
from builder import KerasModelBuilder, ModelBuildError
from environment import capture_environment
from evaluator import ModelEvaluator
from metrics import compare_with_baselines, generalization_gap
from object_storage import ObjectStorageError, object_storage
from preprocessing import DataPreparationError, PreparedDataset, prepare_dataset
from reproducibility import configure_determinism
from storage import ArtifactStorageError, ArtifactStorageManager
from trainer import train_model
from worker_config import (
    CANCEL_DIR,
    DATA_DIR,
    EVENT_DIR,
    MODEL_DIR,
    PROCESSING_DIR,
    QUEUE_BACKEND,
    QUEUE_DIR,
    QUEUE_POLL_SECONDS,
    REDIS_URL,
    TEMP_DIR,
    TRAINING_QUEUE,
    WORKER_HEARTBEAT_TIMEOUT_SECONDS,
)
from worker_events import (
    EventPublisher,
    clear_filesystem_cancel,
    filesystem_cancel_requested,
    redis_cancel_requested,
)

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("neurolab.worker")

# Identidad del proceso de entrenamiento. Se persiste en cada trabajo para que
# el lease (worker_id + heartbeat) sea verificable desde cualquier réplica.
WORKER_ID = os.getenv("WORKER_ID") or f"{socket.gethostname()}:{os.getpid()}"

TERMINAL = {"COMPLETED", "CANCELLED"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _resolve_dataset_path(storage_key: str) -> Path:
    base = Path(DATA_DIR).resolve()
    candidate = (base / storage_key).resolve()
    if candidate != base and base not in candidate.parents:
        raise DataPreparationError("Ruta de dataset inválida")
    if not candidate.exists():
        raise DataPreparationError("El archivo del dataset no existe en el almacenamiento compartido")
    return candidate


def _materialize_dataset(storage_key: str, job_id: UUID) -> Path:
    """Devuelve una ruta local al CSV, descargándolo del bucket si aplica."""
    if not object_storage.enabled:
        return _resolve_dataset_path(storage_key)

    destination = Path(TEMP_DIR) / f"{job_id}.csv"
    try:
        destination.parent.mkdir(parents=True, exist_ok=True)
        object_storage.download_to(storage_key, destination)
    except ObjectStorageError as exc:
        raise DataPreparationError(str(exc)) from exc
    return destination


class TrainingWorkerDaemon:
    def __init__(self) -> None:
        self.publisher = EventPublisher()
        self.redis_client = None
        self._stopping = False
        for directory in (QUEUE_DIR, PROCESSING_DIR, CANCEL_DIR, EVENT_DIR, MODEL_DIR):
            Path(directory).mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Cancelación
    # ------------------------------------------------------------------
    def _check_cancel(self, job_id: UUID) -> bool:
        if filesystem_cancel_requested(job_id):
            return True
        if redis_cancel_requested(job_id, self.publisher):
            return True
        try:
            return db.cancel_requested(job_id)
        except Exception:
            logger.debug("No fue posible consultar cancel_requested", exc_info=True)
            return False

    def _finish_cancelled(self, job_id: UUID, progress: float, reason: str = "Cancelado por el usuario") -> None:
        db.set_job_status(
            job_id,
            "CANCELLED",
            progress=min(99.0, max(0.0, progress)),
            error_message=None,
            ended_at=_now(),
        )
        job = db.get_job(job_id) or {}
        try:
            db.record_audit(
                actor_id=job.get("requested_by"),
                project_id=job.get("project_id"),
                action="TRAINING_JOB_CANCELLED",
                metadata_payload={"job_id": str(job_id), "reason": reason},
            )
        except Exception:
            logger.debug("No fue posible registrar auditoría de cancelación", exc_info=True)
        clear_filesystem_cancel(job_id)
        self.publisher.state(job_id, "CANCELLED", progress=progress, metrics_history=db.metric_history(job_id))

    # ------------------------------------------------------------------
    # Ejecución
    # ------------------------------------------------------------------
    def execute_job(self, payload: Dict[str, Any]) -> str:
        job_id = UUID(str(payload["job_id"]))
        project_id = UUID(str(payload["project_id"]))
        job = db.get_job(job_id)
        if job and job.get("status") in TERMINAL:
            logger.info("Trabajo %s ya está en estado %s; se omite.", job_id, job["status"])
            return str(job["status"])

        hyperparameters = payload.get("hyperparameters") or {}
        target_column = (payload.get("target_column") or "").strip()
        architecture = payload.get("architecture") or {}
        dataset = payload.get("dataset") or {}
        storage_key = dataset.get("storage_key")
        if not target_column or not storage_key:
            raise DataPreparationError("El payload del trabajo no contiene target_column o storage_key")

        raw_seed = hyperparameters.get("random_seed")
        seed = 42 if raw_seed is None else int(raw_seed)
        # Se aplica antes de construir el modelo: el determinismo de operaciones
        # debe activarse antes de crear capas y de ejecutar el primer paso.
        reproducibility = configure_determinism(
            seed,
            deterministic=bool(hyperparameters.get("deterministic", True)),
        )
        environment = capture_environment()

        if self._check_cancel(job_id):
            self._finish_cancelled(job_id, 0.0, "Cancelado antes de iniciar")
            return "CANCELLED"

        logger.info("==> Trabajo %s: QUEUED -> PREPARING", job_id)
        claimed = db.claim_job(
            job_id,
            progress=0.0,
            started_at=_now(),
            error_message="",
            worker_id=WORKER_ID,
            heartbeat_at=_now(),
        )
        if not claimed:
            current = db.get_job(job_id)
            status = str((current or {}).get("status") or "CANCELLED")
            logger.info("Trabajo %s ya no es reclamable (estado %s); se omite.", job_id, status)
            return status
        try:
            db.clear_metrics(job_id)
        except Exception:
            logger.debug("No fue posible limpiar métricas previas", exc_info=True)
        self.publisher.state(job_id, "PREPARING", progress=0.0)

        downloaded_dataset = False
        try:
            csv_path = _materialize_dataset(str(storage_key), job_id)
            downloaded_dataset = object_storage.enabled
            expected_checksum = dataset.get("checksum")
            if expected_checksum:
                actual_checksum = hashlib.sha256(Path(csv_path).read_bytes()).hexdigest()
                if actual_checksum != expected_checksum:
                    raise DataPreparationError(
                        f"Integridad del dataset comprometida: checksum esperado {expected_checksum[:12]}, obtenido {actual_checksum[:12]}"
                    )
            validation_split = float(hyperparameters.get("validation_split", 0.15) or 0.15)
            try:
                data: PreparedDataset = prepare_dataset(
                    csv_path,
                    target_column=target_column,
                    task=payload.get("task") or dataset.get("metadata_json", {}).get("task"),
                    val_split=validation_split,
                    test_split=0.15,
                    random_state=seed,
                )
            finally:
                if downloaded_dataset:
                    Path(csv_path).unlink(missing_ok=True)
            logger.info(
                "Dataset preparado: %s filas, %s características, tarea=%s",
                data.samples,
                data.input_dim,
                data.task,
            )
            if self._check_cancel(job_id):
                self._finish_cancelled(job_id, 0.0, "Cancelado tras preparar dataset")
                return "CANCELLED" 

            model = KerasModelBuilder.build_model(
                config=architecture.get("config_json") or {},
                family=architecture.get("family") or "",
                input_dim=data.input_dim,
                output_units=data.output_units,
                output_activation=data.output_activation,
                loss=data.loss,
                metrics=data.metrics,
                hyperparameters=hyperparameters,
            )

            total_epochs = int(hyperparameters.get("epochs", 30) or 30)
            model.summary(print_fn=lambda line: logger.debug(line))

            db.set_job_status(
                job_id,
                "RUNNING",
                progress=1.0,
                worker_id=WORKER_ID,
                heartbeat_at=_now(),
            )
            self.publisher.state(job_id, "RUNNING", progress=1.0)

            def on_epoch(epoch: int, metrics: Dict[str, float]) -> None:
                progress = min(99.0, round((epoch / max(1, total_epochs)) * 100.0, 2))
                try:
                    db.insert_metrics(job_id, epoch, metrics)
                    db.update_job(job_id, progress=progress)
                    db.touch_job(job_id, WORKER_ID)
                except Exception:
                    logger.warning("No fue posible persistir métricas de la época %s", epoch, exc_info=True)
                self.publisher.epoch(job_id, epoch, total_epochs, metrics, progress)

            outcome = train_model(
                model,
                X_train=data.X_train,
                y_train=data.y_train,
                X_val=data.X_val,
                y_val=data.y_val,
                hyperparameters=hyperparameters,
                on_epoch=on_epoch,
                check_cancel=lambda: self._check_cancel(job_id),
                class_weights=data.class_weights,
            )

            if outcome.status == "CANCELLED":
                logger.info("Trabajo %s cancelado en la época %s", job_id, outcome.epochs_completed)
                self._finish_cancelled(job_id, outcome.epochs_completed / max(1, total_epochs) * 100.0)
                return "CANCELLED"

            if outcome.status == "TIMEOUT":
                message = "El entrenamiento excedió el tiempo máximo configurado"
                final_progress = min(99.0, outcome.epochs_completed / max(1, total_epochs) * 100.0)
                db.set_job_status(job_id, "FAILED", progress=final_progress, error_message=message, ended_at=_now())
                self.publisher.state(job_id, "FAILED", progress=final_progress, error_message=message)
                return "FAILED" 

            logger.info("Trabajo %s: evaluando modelo final", job_id)
            evaluation = ModelEvaluator.evaluate(model, data)

            logger.info("Trabajo %s: calculando baselines de referencia", job_id)
            baseline_report = compute_baselines(data, random_state=seed)
            comparison = compare_with_baselines(
                evaluation, baseline_report, task=data.task
            )
            generalization = generalization_gap(outcome.history)

            artifacts = ArtifactStorageManager.save_model_artifact(
                model=model,
                data=data,
                project_id=project_id,
                job_id=job_id,
                hyperparameters=hyperparameters,
                architecture=architecture,
                dataset=dataset,
                evaluation=evaluation,
                baseline_report=baseline_report,
                comparison=comparison,
                generalization=generalization,
                environment=environment,
                reproducibility=reproducibility,
                training_summary={
                    "epochs_completed": outcome.epochs_completed,
                    "early_stopped": outcome.early_stopped,
                    "best_epoch": outcome.best_epoch,
                    "duration_seconds": outcome.duration_seconds,
                    "final_metrics": outcome.final_metrics,
                },
                dataset_filename=dataset.get("original_filename"),
            )

            dataset_description = describe_dataset(data)
            metrics_summary = {
                **evaluation,
                "epochs_completed": outcome.epochs_completed,
                "dataset_checksum": dataset.get("checksum"),
                "dataset_version": dataset.get("version"),
                "code_version": hyperparameters.get("code_version", "1.0.0"),
                "artifacts": artifacts["artifacts"],
                "class_labels": data.class_labels,
                # --- Trazabilidad y evaluación comparada (Nivel A) ---
                "baselines": baseline_report,
                "baseline_comparison": comparison,
                "generalization": generalization,
                "dataset": dataset_description,
                "class_weights": weights_to_json(data.class_weights, list(data.class_labels)),
                "training": {
                    "epochs_completed": outcome.epochs_completed,
                    "early_stopped": outcome.early_stopped,
                    "best_epoch": outcome.best_epoch,
                    "duration_seconds": outcome.duration_seconds,
                },
                "reproducibility": reproducibility,
                "environment": {
                    "python": environment.get("python"),
                    "packages": environment.get("packages"),
                    "git_commit": environment.get("git_commit"),
                },
                "input_schema": data.input_schema,
                "feature_columns": list(data.numeric_columns) + list(data.categorical_columns),
                "model_card": "model_card.md",
            }
            model_version = db.create_model_version(
                project_id=project_id,
                job_id=job_id,
                storage_key=artifacts["storage_key"],
                checksum=artifacts["checksum"],
                metrics_summary=metrics_summary,
            )

            # La ficha se publica después de conocer la versión asignada por el
            # registro; si falla, el modelo ya está persistido y el trabajo sigue
            # siendo válido (solo se pierde la ficha legible).
            try:
                card_artifacts = ArtifactStorageManager.publish_model_card(
                    artifact_dir=artifacts["artifact_dir"],
                    manifest=artifacts["manifest"],
                    version=model_version["version"],
                )
                # El manifiesto se reescribe con model_version y se agrega la
                # ficha; actualizar los hashes evita una discrepancia de
                # integridad entre lo registrado y lo publicado.
                try:
                    db.update_model_artifacts(
                        model_id=model_version["id"], artifacts=card_artifacts
                    )
                except Exception:
                    logger.warning(
                        "No fue posible actualizar los hashes de la ficha en el registro",
                        exc_info=True,
                    )
                logger.info("Ficha del modelo publicada: %s", card_artifacts["model_card"]["path"])
            except ArtifactStorageError as exc:
                logger.warning("No fue posible publicar la ficha del modelo: %s", exc)

            db.set_job_status(job_id, "COMPLETED", progress=100.0, ended_at=_now(), error_message="")
            try:
                db.record_audit(
                    actor_id=(job or {}).get("requested_by"),
                    project_id=project_id,
                    action="TRAINING_JOB_COMPLETED",
                    metadata_payload={
                        "job_id": str(job_id),
                        "model_version_id": str(model_version["id"]),
                        "model_version": model_version["version"],
                        "checksum": artifacts["checksum"],
                        "random_seed": seed,
                        "beats_baseline": comparison.get("beats_baseline"),
                        "metrics": {
                            key: value
                            for key, value in evaluation.items()
                            if isinstance(value, (int, float))
                        },
                    },
                )
            except Exception:
                logger.debug("No fue posible registrar auditoría de finalización", exc_info=True)

            self.publisher.state(
                job_id,
                "COMPLETED",
                progress=100.0,
                metrics_history=db.metric_history(job_id),
            )
            logger.info(
                "==> Trabajo %s COMPLETED. Versión %s checksum=%s",
                job_id,
                model_version["version"],
                artifacts["checksum"][:12],
            )
            return "COMPLETED"

        except (DataPreparationError, ModelBuildError, ArtifactStorageError) as exc:
            logger.error("Trabajo %s falló por validación: %s", job_id, exc)
            self._mark_failed(job_id, str(exc), project_id)
            return "FAILED"
        except Exception as exc:  # error inesperado de entrenamiento
            logger.error("Trabajo %s falló: %s", job_id, exc)
            logger.debug(traceback.format_exc())
            self._mark_failed(
                job_id,
                f"Error de entrenamiento ({type(exc).__name__}): {exc}",
                project_id,
            )
            return "FAILED"

    def _mark_failed(self, job_id: UUID, message: str, project_id: UUID) -> None:
        try:
            db.set_job_status(job_id, "FAILED", error_message=message, ended_at=_now())
            job = db.get_job(job_id) or {}
            db.record_audit(
                actor_id=job.get("requested_by"),
                project_id=project_id,
                action="TRAINING_JOB_FAILED",
                metadata_payload={"job_id": str(job_id), "error": message[:2000]},
            )
        except Exception:
            logger.debug("No fue posible persistir el fallo del trabajo", exc_info=True)
        self.publisher.state(job_id, "FAILED", error_message=message, metrics_history=db.metric_history(job_id))

    # ------------------------------------------------------------------
    # Colas
    # ------------------------------------------------------------------
    def _connect_redis(self):
        try:
            import redis

            client = redis.Redis.from_url(REDIS_URL, decode_responses=True)
            client.ping()
            self.redis_client = client
            logger.info("Worker conectado a Redis (%s), cola=%s", REDIS_URL, TRAINING_QUEUE)
            return client
        except Exception as exc:
            logger.warning("Redis no disponible (%s). Reintentando...", exc)
            self.redis_client = None
            return None

    def _recover_processing(self) -> None:
        for path in Path(PROCESSING_DIR).glob("*.json"):
            target = Path(QUEUE_DIR) / path.name
            try:
                os.replace(path, target)
                logger.info("Trabajo recuperado de procesamiento incompleto: %s", target.name)
            except OSError:
                logger.warning("No fue posible recuperar %s", path, exc_info=True)

    def warm_up(self) -> None:
        """Paga una sola vez las inicializaciones perezosas antes del primer trabajo.

        Sin esto, el primer trabajo de un worker recién arrancado absorbía el
        coste de abrir el motor de base de datos, inicializar los generadores
        de Keras y capturar el entorno. Al hacerlo al arrancar, la espera del
        usuario se reduce al sondeo de la cola.
        """
        try:
            db.get_job(uuid.uuid4())
            configure_determinism(42, deterministic=False)
            capture_environment()
            self.publisher.warm_up()
        except Exception:
            logger.debug("Calentamiento del worker incompleto", exc_info=True)

    def _next_filesystem_job(self) -> Optional[Dict[str, Any]]:
        candidates = sorted(Path(QUEUE_DIR).glob("*.json"))
        if not candidates:
            return None
        path = candidates[0]
        claimed = Path(PROCESSING_DIR) / path.name
        try:
            os.replace(path, claimed)
        except OSError:
            return None
        try:
            payload = json.loads(claimed.read_text(encoding="utf-8"))
        except Exception:
            logger.error("Payload de cola inválido: %s", claimed, exc_info=True)
            claimed.unlink(missing_ok=True)
            return None
        payload["_queue_file"] = str(claimed)
        return payload

    def _ack_filesystem(self, payload: Dict[str, Any]) -> None:
        path = payload.get("_queue_file")
        if path:
            try:
                Path(path).unlink(missing_ok=True)
            except OSError:
                pass

    def run_once(self) -> bool:
        if QUEUE_BACKEND == "filesystem":
            payload = self._next_filesystem_job()
            if not payload:
                return False
            try:
                self.execute_job(payload)
            finally:
                self._ack_filesystem(payload)
            return True

        if self.redis_client is None and self._connect_redis() is None:
            return False
        try:
            item = self.redis_client.blpop(TRAINING_QUEUE, timeout=5)
        except Exception as exc:
            logger.warning("Error leyendo la cola Redis: %s", exc)
            self.redis_client = None
            return False
        if not item:
            return False
        _, raw = item
        payload = json.loads(raw)
        self.execute_job(payload)
        return True

    def run_forever(self) -> None:
        self.warm_up()
        logger.info(
            "NeuroLab Training Worker activo (backend=%s, data=%s, models=%s)",
            QUEUE_BACKEND,
            DATA_DIR,
            MODEL_DIR,
        )
        try:
            recovered_count = db.recover_orphaned_jobs(
                stale_after_seconds=WORKER_HEARTBEAT_TIMEOUT_SECONDS
            )
            if recovered_count > 0:
                logger.warning("Se recuperaron %d trabajos huérfanos que quedaron en RUNNING/PREPARING", recovered_count)
        except Exception:
            logger.exception("Error recuperando trabajos huérfanos al inicio del worker")
        if QUEUE_BACKEND == "filesystem":
            self._recover_processing()
        while not self._stopping:
            try:
                processed = self.run_once()
                if not processed:
                    time.sleep(QUEUE_POLL_SECONDS)
            except KeyboardInterrupt:
                break
            except Exception:
                logger.error("Error en el bucle del worker", exc_info=True)
                time.sleep(QUEUE_POLL_SECONDS)

    def stop(self, *_args) -> None:
        self._stopping = True


def _parse_args(argv: Optional[list] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Worker de entrenamiento NeuroLab")
    parser.add_argument("--once", action="store_true", help="Procesa un trabajo y finaliza")
    parser.add_argument("--job-id", help="Ejecuta un trabajo concreto reconstruido desde la base de datos")
    parser.add_argument("--payload", help="Ruta a un payload JSON (pruebas/operación)")
    return parser.parse_args(argv)


def main(argv: Optional[list] = None) -> int:
    args = _parse_args(argv)
    daemon = TrainingWorkerDaemon()
    signal.signal(signal.SIGTERM, daemon.stop)
    if hasattr(signal, "SIGINT"):
        signal.signal(signal.SIGINT, daemon.stop)

    if args.payload:
        payload = json.loads(Path(args.payload).read_text(encoding="utf-8"))
        status = daemon.execute_job(payload)
        return 0 if status in {"COMPLETED", "CANCELLED"} else 1

    if args.job_id:
        try:
            job_id = UUID(args.job_id)
        except ValueError:
            logger.error("job-id inválido: %s", args.job_id)
            return 2
        payload = db.get_job_bundle(job_id)
        if not payload:
            logger.error("No se encontró el trabajo %s en la base de datos", job_id)
            return 2
        status = daemon.execute_job(payload)
        return 0 if status in {"COMPLETED", "CANCELLED"} else 1

    if args.once:
        processed = daemon.run_once()
        if not processed:
            logger.info("No hay trabajos pendientes")
        return 0

    daemon.run_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
