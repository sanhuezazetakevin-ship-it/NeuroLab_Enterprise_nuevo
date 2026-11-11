"""Endpoints de inferencia y trazabilidad de modelos.

Estos endpoints son *opcionales*: si el despliegue no instaló TensorFlow y
scikit-learn, ``/predict`` responde 503 y el resto de la API sigue operando.
La descarga de artefactos, la ficha y el manifiesto no requieren esas
dependencias.
"""

from __future__ import annotations

import json
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user, project_access
from app.modules.audit.service import record_audit
from app.modules.inference import service as inference
from app.repositories.models import ModelVersionModel, UserModel
from app.schemas.inference import PredictionRequest, PredictionResponse

logger = logging.getLogger("neurolab.inference.api")

router = APIRouter(tags=["Inferencia"])


async def _authorized_model(
    model_id: UUID, user: UserModel, db: AsyncSession
) -> ModelVersionModel:
    model = await db.get(ModelVersionModel, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Versión de modelo no encontrada")
    await project_access(db, model.project_id, user)
    return model


def _ensure_serving_allowed(model: ModelVersionModel) -> None:
    if model.status == "RETIRED":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El modelo está retirado y no puede usarse para inferencia",
        )
    if settings.INFERENCE_REQUIRE_APPROVED and model.status != "APPROVED":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "La política de inferencia exige modelos aprobados; "
                f"el estado actual es {model.status}"
            ),
        )


@router.post(
    "/models/{model_id}/predict",
    response_model=PredictionResponse,
    summary="Ejecutar inferencia real sobre un modelo entrenado",
)
async def predict(
    model_id: UUID,
    payload: PredictionRequest,
    user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    model = await _authorized_model(model_id, user, db)
    _ensure_serving_allowed(model)

    summary = model.metrics_summary or {}
    # Validación temprana: evita cargar TensorFlow para una petición inválida.
    if payload.threshold is not None:
        labels = summary.get("class_labels") or []
        if summary.get("task") not in (None, "classification") or (
            labels and len(labels) != 2
        ):
            raise HTTPException(
                status_code=422,
                detail="El umbral de decisión solo aplica a clasificación binaria",
            )

    try:
        result = await run_in_threadpool(
            inference.predict,
            storage_key=model.storage_key,
            records=payload.records,
            threshold=payload.threshold,
            metrics_summary=summary,
        )
    except inference.InferenceUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    except inference.ArtifactUnavailable as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except inference.PredictionInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except inference.InferenceError as exc:
        logger.exception("Fallo de inferencia en el modelo %s", model.id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    try:
        await record_audit(
            db,
            actor_id=user.id,
            action="MODEL_PREDICTED",
            project_id=model.project_id,
            # No se registran los datos de entrada: pueden ser personales.
            metadata={
                "model_id": str(model.id),
                "version": model.version,
                "records": len(payload.records),
                "task": result["task"],
                "decision_threshold": result["decision_threshold"],
            },
        )
        await db.commit()
    except Exception:  # la auditoría no debe tumbar una inferencia válida
        await db.rollback()
        logger.warning("No fue posible registrar la auditoría de inferencia", exc_info=True)

    return PredictionResponse(
        model_id=model.id,
        model_version=model.version,
        model_status=model.status,
        **result,
    )


@router.get(
    "/models/{model_id}/card",
    summary="Descargar la ficha del modelo (model card) en Markdown",
)
async def get_model_card(
    model_id: UUID,
    user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    model = await _authorized_model(model_id, user, db)
    try:
        content = await run_in_threadpool(
            inference.read_text_artifact, model.storage_key, "model_card.md"
        )
    except inference.ArtifactUnavailable as exc:
        raise HTTPException(
            status_code=404,
            detail="La ficha del modelo no está disponible para esta versión",
        ) from exc
    except inference.InferenceError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return Response(
        content=content,
        media_type="text/markdown; charset=utf-8",
        headers={
            "Content-Disposition": f'inline; filename="model_card_{model.version}.md"'
        },
    )


@router.get(
    "/models/{model_id}/manifest",
    summary="Obtener el manifiesto auditable del entrenamiento",
)
async def get_model_manifest(
    model_id: UUID,
    user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    model = await _authorized_model(model_id, user, db)
    try:
        text = await run_in_threadpool(
            inference.read_text_artifact, model.storage_key, "training_manifest.json"
        )
    except inference.ArtifactUnavailable as exc:
        raise HTTPException(
            status_code=404,
            detail="El manifiesto no está disponible para esta versión",
        ) from exc
    except inference.InferenceError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=500, detail="El manifiesto almacenado no es JSON válido"
        ) from exc
