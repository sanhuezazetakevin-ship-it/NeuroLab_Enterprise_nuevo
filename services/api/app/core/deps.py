from typing import Optional
from uuid import UUID

from fastapi import Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import decode_access_token, oauth2_scheme
from app.repositories.models import ProjectMemberModel, ProjectModel, UserModel

ADMIN = "ADMIN"
PROJECT_LEAD = "PROJECT_LEAD"
AI_ENGINEER = "AI_ENGINEER"
REVIEWER = "REVIEWER"
VIEWER = "VIEWER"

ALL_ROLES = {ADMIN, PROJECT_LEAD, AI_ENGINEER, REVIEWER, VIEWER}
WRITE_ROLES = {ADMIN, PROJECT_LEAD, AI_ENGINEER}
APPROVAL_ROLES = {ADMIN, PROJECT_LEAD, REVIEWER}
MODEL_STATUS_ROLES = {ADMIN, PROJECT_LEAD, AI_ENGINEER, REVIEWER}
AUDIT_ROLES = {ADMIN, PROJECT_LEAD, AI_ENGINEER, REVIEWER}
READ_ROLES = ALL_ROLES


def unauthorized(detail: str = "Credenciales inválidas") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def forbidden(detail: str = "No tiene permisos para ejecutar esta acción") -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


async def get_current_user(
    token: Optional[str] = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> UserModel:
    if not token:
        raise unauthorized("Token de autenticación requerido")
    payload = decode_access_token(token)
    user = await db.get(UserModel, UUID(payload["sub"]))
    if not user or user.status != "ACTIVE":
        raise unauthorized("Usuario inexistente o inactivo")
    return user


async def get_optional_user(
    token: Optional[str] = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> Optional[UserModel]:
    if not token:
        return None
    try:
        payload = decode_access_token(token)
        user = await db.get(UserModel, UUID(payload["sub"]))
    except HTTPException:
        return None
    if user and user.status == "ACTIVE":
        return user
    return None


async def get_user_from_token(token: str, db: AsyncSession) -> UserModel:
    """Autenticación para WebSocket/SSE donde no hay cabeceras Authorization."""
    if not token:
        raise unauthorized("Token de autenticación requerido")
    payload = decode_access_token(token)
    user = await db.get(UserModel, UUID(payload["sub"]))
    if not user or user.status != "ACTIVE":
        raise unauthorized("Usuario inexistente o inactivo")
    return user


def require_roles(*roles: str):
    allowed = set(roles)

    async def dependency(user: UserModel = Depends(get_current_user)) -> UserModel:
        if user.role not in allowed:
            raise forbidden(f"Rol '{user.role}' insuficiente para esta operación")
        return user

    return dependency


async def project_access(
    db: AsyncSession, project_id: UUID, user: UserModel
) -> tuple[ProjectModel, str]:
    """Devuelve (proyecto, rol_efectivo) o 404 para no filtrar recursos ajenos."""
    project = await db.get(ProjectModel, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")

    if user.role == ADMIN:
        return project, ADMIN
    if project.owner_id == user.id:
        return project, PROJECT_LEAD

    membership = await db.scalar(
        select(ProjectMemberModel).where(
            ProjectMemberModel.project_id == project_id,
            ProjectMemberModel.user_id == user.id,
        )
    )
    if not membership:
        # 404 deliberado: un usuario no debe saber si el proyecto ajeno existe.
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    return project, membership.role


def ensure_project_role(effective_role: str, allowed: set[str], action: str = "esta acción") -> None:
    if effective_role not in allowed:
        raise forbidden(f"Rol '{effective_role}' no autorizado para {action}")


def accessible_projects_subquery(user: UserModel):
    memberships = select(ProjectMemberModel.project_id).where(ProjectMemberModel.user_id == user.id)
    return or_(ProjectModel.owner_id == user.id, ProjectModel.id.in_(memberships))
