from datetime import datetime
from typing import Any, Dict, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict

ModelStatus = Literal["DRAFT", "REVIEWED", "APPROVED", "RETIRED"]


class ModelStatusUpdate(BaseModel):
    status: ModelStatus
    reason: Optional[str] = None


class ModelVersionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    job_id: UUID
    version: str
    storage_key: str
    status: ModelStatus
    checksum: str
    metrics_summary: Optional[Dict[str, Any]] = None
    created_at: datetime
