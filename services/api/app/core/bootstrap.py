import logging
import secrets

from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.security import get_password_hash
from app.repositories.models import UserModel

logger = logging.getLogger("neurolab.bootstrap")


async def ensure_seed_admin() -> None:
    """Crea la cuenta inicial sólo si la tabla de usuarios está vacía.

    No restablece contraseñas ni crea usuarios adicionales: cambiar la clave
    inicial es responsabilidad operativa (ver docs/operations).
    """
    async with AsyncSessionLocal() as db:
        existing = await db.scalar(select(UserModel).limit(1))
        if existing:
            return
        password = settings.SEED_ADMIN_PASSWORD
        generated = not password
        if generated:
            password = secrets.token_urlsafe(12)
        admin = UserModel(
            email=settings.SEED_ADMIN_EMAIL.lower(),
            password_hash=get_password_hash(password),
            display_name=settings.SEED_ADMIN_NAME,
            role="ADMIN",
            status="ACTIVE",
        )
        db.add(admin)
        await db.commit()
        if generated:
            logger.warning(
                "Usuario administrador inicial creado: %s. Contraseña generada: %s "
                "(cópiela ahora; no se volverá a mostrar). Cambie la contraseña en el primer acceso.",
                admin.email,
                password,
            )
        else:
            logger.warning(
                "Usuario administrador inicial creado: %s. Cambie la contraseña en el primer acceso.",
                admin.email,
            )
