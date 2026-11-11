from datetime import datetime
from typing import Any, Dict, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class AuditEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    actor_id: Optional[UUID] = None
    actor_name: Optional[str] = None
    project_id: Optional[UUID] = None
    action: str
    metadata_json: Dict[str, Any]
    created_at: datetime
