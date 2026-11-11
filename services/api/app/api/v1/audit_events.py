from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import AUDIT_ROLES, ensure_project_role, get_current_user, project_access
from app.repositories.models import AuditEventModel, UserModel
from app.schemas.audit import AuditEventResponse

router = APIRouter(tags=["Auditoría"])


@router.get("/projects/{project_id}/audit-events", response_model=List[AuditEventResponse])
async def list_audit_events(
    project_id: UUID,
    action: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _, role = await project_access(db, project_id, user)
    ensure_project_role(role, AUDIT_ROLES, "consultar los eventos de auditoría del proyecto")
    stmt = (
        select(AuditEventModel, UserModel)
        .outerjoin(UserModel, UserModel.id == AuditEventModel.actor_id)
        .where(AuditEventModel.project_id == project_id)
        .order_by(AuditEventModel.created_at.desc())
        .limit(limit)
    )
    if action:
        stmt = stmt.where(AuditEventModel.action == action)

    rows = (await db.execute(stmt)).all()
    return [
        AuditEventResponse(
            id=event.id,
            actor_id=event.actor_id,
            actor_name=actor.display_name if actor else None,
            project_id=event.project_id,
            action=event.action,
            metadata_json=event.metadata_json or {},
            created_at=event.created_at,
        )
        for event, actor in rows
    ]
