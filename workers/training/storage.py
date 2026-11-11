"""Persistencia de artefactos inmutables del modelo entrenado.

Cada entrenamiento produce un directorio inmutable:

    models/<project_id>/<job_id>/
        model.keras          modelo serializado
        scaler.pkl           metadatos + preprocesador para inferencia
        preprocessor.pkl     ColumnTransformer ajustado
        training_manifest.json  manifiesto auditable
        model_card.md        ficha legible del modelo

Todos los archivos se publican también en el almacenamiento configurado
(local o bucket S3) con su SHA-256, de modo que la API pueda servirlos sin
compartir volumen con el worker.
"""

from __future__ import annotations

import hashlib
import json
import logging
import pickle
from pathlib import Path
from typing import Any, Dict, Optional
from uuid import UUID

from manifest import build_manifest, render_model_card
from object_storage import ObjectStorageError, object_storage
from preprocessing import PreparedDataset
from worker_config import CODE_VERSION, MODEL_DIR

logger = logging.getLogger("neurolab.storage")


class ArtifactStorageError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _relative(path: Path) -> str:
    return path.relative_to(Path(MODEL_DIR).resolve()).as_posix()


class ArtifactStorageManager:
    @staticmethod
    def artifact_directory(project_id: UUID, job_id: UUID) -> Path:
        directory = (Path(MODEL_DIR) / "models" / str(project_id) / str(job_id)).resolve()
        base = Path(MODEL_DIR).resolve()
        if base not in directory.parents:
            raise ArtifactStorageError("Ruta de artefactos fuera del almacenamiento permitido")
        directory.mkdir(parents=True, exist_ok=True)
        return directory

    @staticmethod
    def _upload(path: Path, content_type: str) -> str:
        relative = _relative(path)
        object_storage.put_file(path, relative, content_type)
        return relative

    @staticmethod
    def save_model_artifact(
        *,
        model,
        data: PreparedDataset,
        project_id: UUID,
        job_id: UUID,
        hyperparameters: Dict[str, Any],
        architecture: Optional[Dict[str, Any]] = None,
        dataset: Optional[Dict[str, Any]] = None,
        evaluation: Optional[Dict[str, Any]] = None,
        baseline_report: Optional[Dict[str, Any]] = None,
        comparison: Optional[Dict[str, Any]] = None,
        generalization: Optional[Dict[str, Any]] = None,
        environment: Optional[Dict[str, Any]] = None,
        reproducibility: Optional[Dict[str, Any]] = None,
        training_summary: Optional[Dict[str, Any]] = None,
        dataset_filename: Optional[str] = None,
        code_version: Optional[str] = None,
    ) -> Dict[str, Any]:
        directory = ArtifactStorageManager.artifact_directory(project_id, job_id)

        model_path = directory / "model.keras"
        try:
            model.save(model_path)
        except Exception as exc:  # pragma: no cover - depende de la versión de Keras
            raise ArtifactStorageError(f"No fue posible guardar el modelo .keras: {exc}") from exc

        scaler_path = directory / "scaler.pkl"
        with scaler_path.open("wb") as handle:
            pickle.dump(data.scaler_bundle(), handle, protocol=pickle.HIGHEST_PROTOCOL)

        preprocessor_path = directory / "preprocessor.pkl"
        with preprocessor_path.open("wb") as handle:
            pickle.dump(data.preprocessor, handle, protocol=pickle.HIGHEST_PROTOCOL)

        relative_model = _relative(model_path)
        relative_scaler = _relative(scaler_path)
        relative_preprocessor = _relative(preprocessor_path)

        artifacts: Dict[str, Any] = {
            "model": {"path": relative_model, "sha256": sha256_file(model_path)},
            "scaler": {"path": relative_scaler, "sha256": sha256_file(scaler_path)},
            "preprocessor": {
                "path": relative_preprocessor,
                "sha256": sha256_file(preprocessor_path),
            },
        }

        manifest = build_manifest(
            project_id=project_id,
            job_id=job_id,
            data=data,
            hyperparameters=hyperparameters,
            architecture=architecture or {},
            dataset=dataset or {},
            evaluation=evaluation or {},
            baseline_report=baseline_report or {},
            comparison=comparison or {},
            generalization=generalization or {},
            environment=environment or {},
            reproducibility=reproducibility or {},
            training_summary=training_summary or {},
            artifacts={
                "model": model_path.name,
                "scaler": scaler_path.name,
                "preprocessor": preprocessor_path.name,
            },
            code_version=code_version or CODE_VERSION,
            dataset_filename=dataset_filename,
        )

        manifest_path = directory / "training_manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2, default=str), encoding="utf-8")
        relative_manifest = _relative(manifest_path)
        artifacts["manifest"] = {
            "path": relative_manifest,
            "sha256": sha256_file(manifest_path),
        }

        try:
            ArtifactStorageManager._upload(model_path, "application/octet-stream")
            ArtifactStorageManager._upload(scaler_path, "application/octet-stream")
            ArtifactStorageManager._upload(preprocessor_path, "application/octet-stream")
            ArtifactStorageManager._upload(manifest_path, "application/json")
        except ObjectStorageError as exc:
            raise ArtifactStorageError(
                f"No fue posible publicar los artefactos en el almacenamiento: {exc}"
            ) from exc

        logger.info(
            "Artefactos guardados en %s (sha256=%s)", relative_model, artifacts["model"]["sha256"]
        )

        return {
            "storage_key": relative_model,
            "checksum": artifacts["model"]["sha256"],
            "artifact_dir": str(directory),
            "artifacts": artifacts,
            "manifest": manifest,
        }

    @staticmethod
    def publish_model_card(
        *,
        artifact_dir: str,
        manifest: Dict[str, Any],
        version: str,
    ) -> Dict[str, Any]:
        """Escribe la ficha del modelo y completa el manifiesto con la versión.

        Se ejecuta después de que la base de datos asigna el número de versión,
        porque la ficha debe identificarlo. Reescribe el manifiesto (ya
        publicado) con el campo ``model_version`` y vuelve a subirlo.
        """
        directory = Path(artifact_dir)
        if not directory.exists():
            raise ArtifactStorageError("El directorio de artefactos no existe")
        base = Path(MODEL_DIR).resolve()
        if base not in directory.resolve().parents:
            raise ArtifactStorageError("Ruta de artefactos fuera del almacenamiento permitido")

        manifest = dict(manifest)
        manifest["model_version"] = version

        card_path = directory / "model_card.md"
        card_path.write_text(render_model_card(manifest), encoding="utf-8")

        manifest_path = directory / "training_manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2, default=str), encoding="utf-8")

        try:
            ArtifactStorageManager._upload(card_path, "text/markdown")
            ArtifactStorageManager._upload(manifest_path, "application/json")
        except ObjectStorageError as exc:
            raise ArtifactStorageError(
                f"No fue posible publicar la ficha del modelo: {exc}"
            ) from exc

        return {
            "model_card": {"path": _relative(card_path), "sha256": sha256_file(card_path)},
            "manifest": {"path": _relative(manifest_path), "sha256": sha256_file(manifest_path)},
        }
