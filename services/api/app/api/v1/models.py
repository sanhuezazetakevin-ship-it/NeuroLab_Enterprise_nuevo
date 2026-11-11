from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.core.database import get_db
from app.core.deps import APPROVAL_ROLES, MODEL_STATUS_ROLES, WRITE_ROLES, ensure_project_role, get_current_user, project_access
from app.core.storage import StorageError, storage
from app.modules.audit.service import record_audit
from app.repositories.models import ModelVersionModel, UserModel
from app.schemas.model import ModelStatusUpdate, ModelVersionResponse

router = APIRouter(tags=["Model Registry"])

TRANSITIONS = {
    "DRAFT": {"REVIEWED", "RETIRED"},
    "REVIEWED": {"APPROVED", "RETIRED"},
    "APPROVED": {"RETIRED"},
    "RETIRED": set(),
}


@router.get("/projects/{project_id}/models", response_model=List[ModelVersionResponse])
async def list_models(
    project_id: UUID,
    user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await project_access(db, project_id, user)
    return (
        await db.scalars(
            select(ModelVersionModel)
            .where(ModelVersionModel.project_id == project_id)
            .order_by(ModelVersionModel.created_at.desc())
        )
    ).all()


@router.get("/models/{model_id}", response_model=ModelVersionResponse)
async def get_model(
    model_id: UUID,
    user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    model = await db.get(ModelVersionModel, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Versión de modelo no encontrada")
    await project_access(db, model.project_id, user)
    return model


@router.patch("/models/{model_id}/status", response_model=ModelVersionResponse)
async def update_model_status(
    model_id: UUID,
    payload: ModelStatusUpdate,
    user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    model = await db.get(ModelVersionModel, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Versión de modelo no encontrada")
    _, role = await project_access(db, model.project_id, user)
    ensure_project_role(role, MODEL_STATUS_ROLES, "cambiar el estado de un modelo")

    if payload.status == model.status:
        return model
    if payload.status not in TRANSITIONS.get(model.status, set()):
        raise HTTPException(
            status_code=409,
            detail=f"Transición no permitida: {model.status} → {payload.status}",
        )
    if payload.status in {"APPROVED", "RETIRED"}:
        ensure_project_role(role, APPROVAL_ROLES, "aprobar o retirar modelos")

    previous = model.status
    model.status = payload.status
    await record_audit(
        db,
        actor_id=user.id,
        action=f"MODEL_{payload.status}",
        project_id=model.project_id,
        metadata={
            "model_id": str(model.id),
            "version": model.version,
            "previous_status": previous,
            "reason": payload.reason,
        },
    )
    await db.commit()
    await db.refresh(model)
    return model


@router.get("/models/{model_id}/download")
async def download_model(
    model_id: UUID,
    user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    model = await db.get(ModelVersionModel, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Versión de modelo no encontrada")
    await project_access(db, model.project_id, user)

    try:
        content = await run_in_threadpool(storage.get_bytes, model.storage_key)
    except StorageError as exc:
        raise HTTPException(
            status_code=404,
            detail="El artefacto no está disponible en el almacenamiento configurado",
        ) from exc
    return Response(
        content=content,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="model_{model.version}.keras"'
        },
    )
