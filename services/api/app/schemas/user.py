from datetime import datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

Role = Literal["ADMIN", "PROJECT_LEAD", "AI_ENGINEER", "REVIEWER", "VIEWER"]


class UserLogin(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=2, max_length=150)
    role: Role = "AI_ENGINEER"


class UserUpdate(BaseModel):
    display_name: Optional[str] = Field(default=None, min_length=2, max_length=150)
    role: Optional[Role] = None
    status: Optional[Literal["ACTIVE", "INACTIVE", "SUSPENDED"]] = None


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=10, max_length=128)


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    display_name: str
    role: Role
    status: str
    created_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserResponse
