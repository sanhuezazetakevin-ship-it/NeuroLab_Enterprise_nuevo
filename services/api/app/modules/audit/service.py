from typing import Any, Dict, Optional
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.models import AuditEventModel


async def record_audit(
    db: AsyncSession,
    *,
    actor_id: Optional[UUID],
    action: str,
    project_id: Optional[UUID] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> AuditEventModel:
    """Registra una acción relevante sin incluir secretos ni datos sensibles."""
    event = AuditEventModel(
        actor_id=actor_id,
        project_id=project_id,
        action=action,
        metadata_json=metadata or {},
    )
    db.add(event)
    return event
