import time
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user, require_roles
from app.core.security import get_password_hash
from app.modules.audit.service import record_audit
from app.modules.training.queue import redis_health, training_queue
from app.repositories.models import UserModel
from app.schemas.user import UserCreate, UserResponse, UserUpdate

router = APIRouter(prefix="/admin", tags=["Administración y Seguridad"])

STARTED_AT = time.monotonic()


@router.get("/users", response_model=List[UserResponse])
async def list_users(
    user: UserModel = Depends(require_roles("ADMIN")),
    db: AsyncSession = Depends(get_db),
):
    return (await db.scalars(select(UserModel).order_by(UserModel.created_at))).all()


@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate,
    admin: UserModel = Depends(require_roles("ADMIN")),
    db: AsyncSession = Depends(get_db),
):
    existing = await db.scalar(select(UserModel).where(UserModel.email == payload.email.lower()))
    if existing:
        raise HTTPException(status_code=409, detail="Ya existe un usuario con ese correo")
    new_user = UserModel(
        email=payload.email.lower(),
        password_hash=get_password_hash(payload.password),
        display_name=payload.display_name,
        role=payload.role,
        status="ACTIVE",
    )
    db.add(new_user)
    await db.flush()
    await record_audit(
        db,
        actor_id=admin.id,
        action="USER_CREATED",
        metadata={"user_id": str(new_user.id), "role": new_user.role},
    )
    await db.commit()
    await db.refresh(new_user)
    return new_user


@router.patch("/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: UUID,
    payload: UserUpdate,
    admin: UserModel = Depends(require_roles("ADMIN")),
    db: AsyncSession = Depends(get_db),
):
    target = await db.get(UserModel, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if target.id == admin.id and payload.status and payload.status != "ACTIVE":
        raise HTTPException(status_code=400, detail="No puede desactivar su propia cuenta")
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(target, field, value)
    await record_audit(
        db,
        actor_id=admin.id,
        action="USER_UPDATED",
        metadata={"user_id": str(target.id), "fields": list(changes.keys())},
    )
    await db.commit()
    await db.refresh(target)
    return target


@router.get("/system")
async def system_status(
    admin: UserModel = Depends(require_roles("ADMIN")),
    db: AsyncSession = Depends(get_db),
):
    db_ok = True
    try:
        await db.execute(text("SELECT 1"))
    except Exception:
        db_ok = False

    redis_ok = await redis_health()

    return {
        "status": "healthy" if db_ok else "degraded",
        "environment": settings.ENVIRONMENT,
        "version": settings.VERSION,
        "database": "up" if db_ok else "down",
        "redis": "up" if redis_ok else "down",
        "queue_backend": training_queue.backend,
        "limits": {
            "max_upload_mb": settings.MAX_UPLOAD_MB,
            "max_csv_rows": settings.MAX_CSV_ROWS,
            "max_csv_columns": settings.MAX_CSV_COLUMNS,
            "token_expire_minutes": settings.ACCESS_TOKEN_EXPIRE_MINUTES,
        },
        "uptime_seconds": round(time.monotonic() - STARTED_AT, 2),
    }
