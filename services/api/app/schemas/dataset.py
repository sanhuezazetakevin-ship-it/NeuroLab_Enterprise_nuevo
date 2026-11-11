from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class DatasetResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    name: str
    version: str
    storage_key: str
    original_filename: Optional[str] = None
    size_bytes: int = 0
    checksum: Optional[str] = None
    target_column: Optional[str] = None
    verified: bool = False
    metadata_json: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class DatasetPreview(BaseModel):
    id: UUID
    columns: List[str]
    dtypes: Dict[str, str]
    rows: List[Dict[str, Any]]
    total_rows: int
    null_counts: Dict[str, int]
