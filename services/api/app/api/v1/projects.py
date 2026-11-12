from datetime import datetime, timezone
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import (
    ADMIN,
    PROJECT_LEAD,
    accessible_projects_subquery,
    ensure_project_role,
    get_current_user,
    project_access,
)
from app.modules.audit.service import record_audit
from app.repositories.models import (
    ArchitectureModel,
    DatasetModel,
    ProjectMemberModel,
    ProjectModel,
    TrainingJobModel,
    UserModel,
)
from app.schemas.project import (
    ProjectCreate,
    ProjectMemberCreate,
    ProjectMemberResponse,
    ProjectResponse,
    ProjectUpdate,
)

router = APIRouter(prefix="/projects", tags=["Proyectos de IA"])


async def _counts(db: AsyncSession, project_id: UUID) -> tuple[int, int, int]:
    architectures = await db.scalar(
        select(func.count()).select_from(ArchitectureModel).where(
            ArchitectureModel.project_id == project_id
        )
    )
    datasets = await db.scalar(
        select(func.count()).select_from(DatasetModel).where(DatasetModel.project_id == project_id)
    )
    jobs = await db.scalar(
        select(func.count()).select_from(TrainingJobModel).where(
            TrainingJobModel.project_id == project_id
        )
    )
    return int(architectures or 0), int(datasets or 0), int(jobs or 0)


async def _to_response(db: AsyncSession, project: ProjectModel, effective_role: str) -> ProjectResponse:
    architectures, datasets, jobs = await _counts(db, project.id)
    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        owner_id=project.owner_id,
        status=project.status,
        network_family=project.network_family or "FEEDFORWARD",
        created_at=project.created_at,
        updated_at=project.updated_at,
        architectures_count=architectures,
        datasets_count=datasets,
        jobs_count=jobs,
        effective_role=effective_role,
    )


@router.get("", response_model=List[ProjectResponse])
async def list_projects(
    user: UserModel = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    stmt = select(ProjectModel).order_by(ProjectModel.created_at.desc())
    if user.role != ADMIN:
        stmt = stmt.where(accessible_projects_subquery(user))
    projects = (await db.scalars(stmt)).all()

    memberships = {
        membership.project_id: membership.role
        for membership in (
            await db.scalars(
                select(ProjectMemberModel).where(ProjectMemberModel.user_id == user.id)
            )
        ).all()
    }
    result = []
    for project in projects:
        if user.role == ADMIN:
            role = ADMIN
        elif project.owner_id == user.id:
            role = PROJECT_LEAD
        else:
            role = memberships.get(project.id, "VIEWER")
        result.append(await _to_response(db, project, role))
    return result


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectCreate,
    user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role not in {ADMIN, PROJECT_LEAD, "AI_ENGINEER"}:
        raise HTTPException(status_code=403, detail="Su rol no permite crear proyectos")
    project = ProjectModel(
        name=payload.name.strip(),
        description=payload.description,
        owner_id=user.id,
        status="ACTIVE",
        network_family=payload.network_family,
    )
    db.add(project)
    await db.flush()
    await record_audit(
        db,
        actor_id=user.id,
        action="PROJECT_CREATED",
        project_id=project.id,
        metadata={"name": project.name, "network_family": project.network_family},
    )
    await db.commit()
    await db.refresh(project)
    return await _to_response(db, project, PROJECT_LEAD if user.role != ADMIN else ADMIN)


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: UUID,
    user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project, role = await project_access(db, project_id, user)
    return await _to_response(db, project, role)


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: UUID,
    payload: ProjectUpdate,
    user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project, role = await project_access(db, project_id, user)
    ensure_project_role(role, {ADMIN, PROJECT_LEAD}, "editar el proyecto")
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(project, field, value.strip() if isinstance(value, str) else value)
    project.updated_at = datetime.now(timezone.utc)
    await record_audit(
        db,
        actor_id=user.id,
        action="PROJECT_UPDATED",
        project_id=project.id,
        metadata={"fields": list(changes.keys())},
    )
    await db.commit()
    await db.refresh(project)
    return await _to_response(db, project, role)


@router.get("/{project_id}/members", response_model=List[ProjectMemberResponse])
async def list_members(
    project_id: UUID,
    user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await project_access(db, project_id, user)
    rows = (
        await db.execute(
            select(ProjectMemberModel, UserModel)
            .join(UserModel, UserModel.id == ProjectMemberModel.user_id)
            .where(ProjectMemberModel.project_id == project_id)
        )
    ).all()
    return [
        ProjectMemberResponse(
            project_id=membership.project_id,
            user_id=membership.user_id,
            role=membership.role,
            added_at=membership.added_at,
            email=member.email,
            display_name=member.display_name,
        )
        for membership, member in rows
    ]


@router.post(
    "/{project_id}/members",
    response_model=ProjectMemberResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_member(
    project_id: UUID,
    payload: ProjectMemberCreate,
    user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project, role = await project_access(db, project_id, user)
    ensure_project_role(role, {ADMIN, PROJECT_LEAD}, "gestionar miembros")
    member = await db.scalar(select(UserModel).where(UserModel.email == payload.email.lower()))
    if not member:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if member.id == project.owner_id:
        raise HTTPException(status_code=400, detail="El propietario ya tiene acceso al proyecto")

    membership = await db.scalar(
        select(ProjectMemberModel).where(
            ProjectMemberModel.project_id == project_id,
            ProjectMemberModel.user_id == member.id,
        )
    )
    if membership:
        membership.role = payload.role
    else:
        membership = ProjectMemberModel(
            project_id=project_id, user_id=member.id, role=payload.role
        )
        db.add(membership)
    await record_audit(
        db,
        actor_id=user.id,
        action="PROJECT_MEMBER_UPSERTED",
        project_id=project_id,
        metadata={"member_email": member.email, "role": payload.role},
    )
    await db.commit()
    await db.refresh(membership)
    return ProjectMemberResponse(
        project_id=membership.project_id,
        user_id=membership.user_id,
        role=membership.role,
        added_at=membership.added_at,
        email=member.email,
        display_name=member.display_name,
    )


@router.delete("/{project_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    project_id: UUID,
    member_id: UUID,
    user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _, role = await project_access(db, project_id, user)
    ensure_project_role(role, {ADMIN, PROJECT_LEAD}, "gestionar miembros")
    membership = await db.scalar(
        select(ProjectMemberModel).where(
            ProjectMemberModel.project_id == project_id,
            ProjectMemberModel.user_id == member_id,
        )
    )
    if not membership:
        raise HTTPException(status_code=404, detail="Miembro no encontrado")
    await db.delete(membership)
    await record_audit(
        db,
        actor_id=user.id,
        action="PROJECT_MEMBER_REMOVED",
        project_id=project_id,
        metadata={"member_id": str(member_id)},
    )
    await db.commit()
