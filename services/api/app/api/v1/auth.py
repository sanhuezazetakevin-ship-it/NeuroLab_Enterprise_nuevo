from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.security import (
    create_access_token,
    get_password_hash,
    verify_password,
)
from app.modules.audit.service import record_audit
from app.modules.security.rate_limit import login_rate_limiter
from app.repositories.models import UserModel
from app.schemas.user import (
    PasswordChange,
    TokenResponse,
    UserLogin,
    UserResponse,
)

router = APIRouter(prefix="/auth", tags=["Autenticación"])


@router.post("/login", response_model=TokenResponse)
async def login(credentials: UserLogin, request: Request, db: AsyncSession = Depends(get_db)):
    email = credentials.email.lower()
    await login_rate_limiter.check(request, email)

    user = await db.scalar(select(UserModel).where(UserModel.email == email))
    if not user or not verify_password(credentials.password, user.password_hash):
        await login_rate_limiter.register_failure(email)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Correo o contraseña incorrectos",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if user.status != "ACTIVE":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="La cuenta no está activa. Contacte al administrador.",
        )

    await login_rate_limiter.reset_failures(email)
    token = create_access_token(
        data={"sub": str(user.id), "email": user.email, "role": user.role}
    )
    await record_audit(
        db,
        actor_id=user.id,
        action="USER_LOGIN",
        metadata={"email": user.email},
    )
    await db.commit()

    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=UserResponse.model_validate(user),
    )


@router.get("/me", response_model=UserResponse)
async def me(user: UserModel = Depends(get_current_user)):
    return user


@router.post("/change-password", status_code=status.HTTP_200_OK)
async def change_password(
    payload: PasswordChange,
    user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="La contraseña actual no es correcta")
    if payload.current_password == payload.new_password:
        raise HTTPException(status_code=400, detail="La nueva contraseña debe ser diferente")
    user.password_hash = get_password_hash(payload.new_password)
    user.updated_at = datetime.now(timezone.utc)
    await record_audit(db, actor_id=user.id, action="USER_PASSWORD_CHANGED")
    await db.commit()
    return {"message": "Contraseña actualizada correctamente"}
