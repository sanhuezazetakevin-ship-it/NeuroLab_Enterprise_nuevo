import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from sqlalchemy import text

from app.api.v1.admin import router as admin_router
from app.api.v1.architectures import router as architectures_router
from app.api.v1.audit_events import router as audit_router
from app.api.v1.auth import router as auth_router
from app.api.v1.datasets import router as datasets_router
from app.api.v1.fundamentals import router as fundamentals_router
from app.api.v1.inference import router as inference_router
from app.api.v1.models import router as models_router
from app.api.v1.projects import router as projects_router
from app.api.v1.training_jobs import router as training_jobs_router
from app.core.bootstrap import ensure_seed_admin
from app.core.config import settings
from app.core.database import AsyncSessionLocal, init_db

logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("neurolab.api")

API_V1_PREFIX = settings.API_V1_STR
DOCS_PATHS = (API_V1_PREFIX + "/docs", API_V1_PREFIX + "/redoc")
STRICT_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
DOCS_CSP = (
    "default-src 'none'; "
    "script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; "
    "style-src 'self' https://cdn.jsdelivr.net https://fonts.googleapis.com 'unsafe-inline'; "
    "font-src https://fonts.gstatic.com https://cdn.jsdelivr.net data:; "
    "img-src 'self' https://fastapi.tiangolo.com data:; "
    "connect-src 'self'; "
    "base-uri 'none'; frame-ancestors 'none'"
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not settings.is_production:
        await init_db()
        await ensure_seed_admin()
    else:
        logger.info("Entorno de producción: el esquema se gestiona con migraciones.")
    yield


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description=(
        "API empresarial para diseño, validación, entrenamiento, evaluación y ciclo de vida "
        "de redes neuronales artificiales (Semana 11)."
    ),
    lifespan=lifespan,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url=f"{settings.API_V1_STR}/docs",
    redoc_url=f"{settings.API_V1_STR}/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=settings.CORS_ORIGIN_REGEX or None,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["Content-Disposition"],
)


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault(
        "Content-Security-Policy",
        DOCS_CSP if request.url.path in DOCS_PATHS else STRICT_CSP,
    )
    response.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
    return response


api_v1 = API_V1_PREFIX
app.include_router(auth_router, prefix=api_v1)
app.include_router(admin_router, prefix=api_v1)
app.include_router(projects_router, prefix=api_v1)
app.include_router(architectures_router, prefix=api_v1)
app.include_router(datasets_router, prefix=api_v1)
app.include_router(training_jobs_router, prefix=api_v1)
app.include_router(models_router, prefix=api_v1)
app.include_router(inference_router, prefix=api_v1)
app.include_router(fundamentals_router, prefix=api_v1)
app.include_router(audit_router, prefix=api_v1)


@app.get("/health", tags=["Salud del Sistema"])
async def health_check():
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(text("SELECT 1"))
        database = "up"
    except Exception:
        database = "down"
    return JSONResponse(
        status_code=200 if database == "up" else 503,
        content={
            "status": "healthy" if database == "up" else "degraded",
            "service": "neurolab-api",
            "version": settings.VERSION,
            "environment": settings.ENVIRONMENT,
            "database": database,
        },
    )


@app.get("/", tags=["Root"])
async def root():
    return {
        "name": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "docs": f"{settings.API_V1_STR}/docs",
    }


@app.get("/metrics", tags=["Monitoreo"])
def prometheus_metrics():
    try:
        from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
        return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)
    except Exception as exc:
        return Response(content=f"# prometheus metrics error: {exc}\n", media_type="text/plain")
