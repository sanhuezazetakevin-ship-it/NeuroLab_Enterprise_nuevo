from datetime import datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.user import Role

NetworkFamily = Literal["FEEDFORWARD", "RNN", "CNN", "GAN"]


class ProjectCreate(BaseModel):
    name: str = Field(min_length=3, max_length=200)
    description: Optional[str] = Field(default=None, max_length=4000)
    network_family: NetworkFamily = "FEEDFORWARD"


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=3, max_length=200)
    description: Optional[str] = Field(default=None, max_length=4000)
    status: Optional[Literal["ACTIVE", "ARCHIVED"]] = None
    network_family: Optional[NetworkFamily] = None


class ProjectResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    description: Optional[str] = None
    owner_id: UUID
    status: str
    network_family: str = "FEEDFORWARD"
    created_at: datetime
    updated_at: datetime
    architectures_count: int = 0
    datasets_count: int = 0
    jobs_count: int = 0
    effective_role: Optional[str] = None


class ProjectMemberCreate(BaseModel):
    email: str
    role: Role


class ProjectMemberResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    project_id: UUID
    user_id: UUID
    role: str
    added_at: datetime
    email: Optional[str] = None
    display_name: Optional[str] = None
