from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import WRITE_ROLES, ensure_project_role, get_current_user, project_access
from app.modules.architectures.validator import ArchitectureValidator
from app.modules.audit.service import record_audit
from app.repositories.models import ArchitectureModel, UserModel
from app.schemas.architecture import (
    ArchitectureCreate,
    ArchitectureResponse,
    ArchitectureValidationResult,
    NetworkTopology,
)

router = APIRouter(prefix="/projects/{project_id}/architectures", tags=["Arquitecturas"])


@router.post("/validate", response_model=ArchitectureValidationResult)
async def validate_architecture(
    project_id: UUID,
    topology: NetworkTopology,
    family: str = "FEEDFORWARD",
    user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await project_access(db, project_id, user)
    return ArchitectureValidator.validate_topology(topology, family)


@router.get("", response_model=List[ArchitectureResponse])
async def list_architectures(
    project_id: UUID,
    user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await project_access(db, project_id, user)
    return (
        await db.scalars(
            select(ArchitectureModel)
            .where(ArchitectureModel.project_id == project_id)
            .order_by(ArchitectureModel.created_at.desc())
        )
    ).all()


@router.post("", response_model=ArchitectureResponse, status_code=status.HTTP_201_CREATED)
async def create_architecture(
    project_id: UUID,
    payload: ArchitectureCreate,
    user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _, role = await project_access(db, project_id, user)
    ensure_project_role(role, WRITE_ROLES, "crear arquitecturas")

    validation = ArchitectureValidator.validate_topology(payload.config_json, payload.family)
    if not validation.valid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"message": "Arquitectura inválida", "errors": validation.errors},
        )

    existing_versions = await db.scalar(
        select(func.count())
        .select_from(ArchitectureModel)
        .where(
            ArchitectureModel.project_id == project_id,
            ArchitectureModel.name == payload.name.strip(),
        )
    )
    architecture = ArchitectureModel(
        project_id=project_id,
        name=payload.name.strip(),
        family=payload.family,
        config_json=payload.config_json.model_dump(),
        version=int(existing_versions or 0) + 1,
        created_by=user.id,
    )
    db.add(architecture)
    await db.flush()
    await record_audit(
        db,
        actor_id=user.id,
        action="ARCHITECTURE_CREATED",
        project_id=project_id,
        metadata={
            "architecture_id": str(architecture.id),
            "family": architecture.family,
            "version": architecture.version,
            "total_parameters": validation.total_parameters,
        },
    )
    await db.commit()
    await db.refresh(architecture)
    return architecture


@router.get("/{architecture_id}", response_model=ArchitectureResponse)
async def get_architecture(
    project_id: UUID,
    architecture_id: UUID,
    user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await project_access(db, project_id, user)
    architecture = await db.get(ArchitectureModel, architecture_id)
    if not architecture or architecture.project_id != project_id:
        raise HTTPException(status_code=404, detail="Arquitectura no encontrada")
    return architecture
