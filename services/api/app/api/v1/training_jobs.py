import logging
from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.responses import StreamingResponse
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import AsyncSessionLocal, get_db
from app.core.deps import WRITE_ROLES, ensure_project_role, get_current_user, project_access
from app.core.security import decode_access_token
from app.modules.architectures.validator import ArchitectureValidator
from app.modules.audit.service import record_audit
from app.modules.security.stream_tickets import consume_stream_ticket, issue_stream_ticket
from app.modules.training.events import (
    format_sse,
    metric_rows_to_history,
    stream_job_events,
)
from app.modules.training.queue import QueueUnavailableError
from app.modules.training.service import training_orchestrator
from app.repositories.models import (
    ArchitectureModel,
    DatasetModel,
    TrainingJobModel,
    TrainingMetricModel,
    UserModel,
)
from app.schemas.architecture import NetworkTopology
from app.schemas.training import TrainingJobCreate, TrainingJobResponse, TrainingMetricResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Entrenamientos"])

ACTIVE_STATES = {"QUEUED", "PREPARING", "RUNNING"}
TERMINAL_STATES = {"COMPLETED", "FAILED", "CANCELLED"}


async def _metrics_by_job(
    db: AsyncSession, job_ids: List[UUID]
) -> dict[UUID, List[dict]]:
    """Carga las métricas de varios trabajos en una sola consulta.

    Evita el N+1 del listado: antes se lanzaba una consulta por cada trabajo.
    """
    if not job_ids:
        return {}
    rows = (
        await db.scalars(
            select(TrainingMetricModel)
            .where(TrainingMetricModel.job_id.in_(job_ids))
            .order_by(TrainingMetricModel.epoch, TrainingMetricModel.metric_name)
        )
    ).all()
    grouped: dict[UUID, List[TrainingMetricModel]] = {}
    for row in rows:
        grouped.setdefault(row.job_id, []).append(row)
    return {job_id: metric_rows_to_history(items) for job_id, items in grouped.items()}


async def _serialize_job(
    db: AsyncSession,
    job: TrainingJobModel,
    metrics: Optional[List[dict]] = None,
) -> TrainingJobResponse:
    history = metrics
    if history is None:
        history = (await _metrics_by_job(db, [job.id])).get(job.id, [])
    return TrainingJobResponse(
        id=job.id,
        project_id=job.project_id,
        architecture_id=job.architecture_id,
        dataset_id=job.dataset_id,
        status=job.status,
        progress=job.progress,
        hyperparameters=job.hyperparameters or {},
        cancel_requested=job.cancel_requested,
        started_at=job.started_at,
        ended_at=job.ended_at,
        error_message=job.error_message,
        created_at=job.created_at,
        metrics=history,
    )


async def _job_with_access(
    db: AsyncSession, job_id: UUID, user: UserModel, write: bool = False
) -> tuple[TrainingJobModel, str]:
    job = await db.get(TrainingJobModel, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Trabajo de entrenamiento no encontrado")
    _, role = await project_access(db, job.project_id, user)
    if write:
        ensure_project_role(role, WRITE_ROLES, "modificar entrenamientos")
    return job, role


@router.get("/projects/{project_id}/training-jobs", response_model=List[TrainingJobResponse])
async def list_training_jobs(
    project_id: UUID,
    user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await project_access(db, project_id, user)
    jobs = (
        await db.scalars(
            select(TrainingJobModel)
            .where(TrainingJobModel.project_id == project_id)
            .order_by(TrainingJobModel.created_at.desc())
        )
    ).all()
    metrics_by_job = await _metrics_by_job(db, [job.id for job in jobs])
    return [
        await _serialize_job(db, job, metrics_by_job.get(job.id, []))
        for job in jobs
    ]


@router.post(
    "/projects/{project_id}/training-jobs",
    response_model=TrainingJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def start_training_job(
    project_id: UUID,
    payload: TrainingJobCreate,
    user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _, role = await project_access(db, project_id, user)
    ensure_project_role(role, WRITE_ROLES, "iniciar entrenamientos")

    architecture = await db.get(ArchitectureModel, payload.architecture_id)
    if not architecture or architecture.project_id != project_id:
        raise HTTPException(status_code=422, detail="La arquitectura no pertenece al proyecto")

    dataset = await db.get(DatasetModel, payload.dataset_id)
    if not dataset or dataset.project_id != project_id:
        raise HTTPException(status_code=422, detail="El dataset no pertenece al proyecto")
    if not dataset.verified:
        raise HTTPException(status_code=422, detail="El dataset no está verificado")

    topology = NetworkTopology.model_validate(architecture.config_json)
    validation = ArchitectureValidator.validate_topology(topology, architecture.family)
    if not validation.valid:
        raise HTTPException(
            status_code=422,
            detail={"message": "Arquitectura inválida", "errors": validation.errors},
        )
    if not validation.trainable:
        raise HTTPException(
            status_code=422,
            detail=validation.trainable_reason or "Familia no habilitada para entrenamiento",
        )

    metadata = dataset.metadata_json or {}
    target = (payload.target_column or dataset.target_column or "").strip()
    if not target:
        raise HTTPException(
            status_code=422,
            detail="Debe indicar la columna objetivo (target) del dataset",
        )
    column_names = {column.get("name") for column in metadata.get("columns", [])}
    if column_names and target not in column_names:
        raise HTTPException(
            status_code=422, detail=f"La columna objetivo '{target}' no existe en el dataset"
        )
    task = payload.task or metadata.get("task")
    if not task:
        raise HTTPException(status_code=422, detail="No fue posible determinar el tipo de tarea")

    # Verificación temprana: la entrada de la arquitectura debe coincidir con
    # las neuronas que produce el CSV tras el preprocesamiento.
    expected_input = (metadata.get("neurons") or {}).get("input_neurons")
    if isinstance(expected_input, int) and expected_input > 0 and topology.input_shape:
        if topology.input_shape[0] != expected_input:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"La arquitectura espera {topology.input_shape[0]} neuronas de entrada, "
                    f"pero el dataset produce {expected_input} tras codificar sus columnas. "
                    "Ajuste el Input Shape al número de características codificadas del CSV."
                ),
            )

    hyperparameters = payload.hyperparameters.model_dump()
    hyperparameters.update(
        {
            "target_column": target,
            "task": task,
            "dataset_checksum": dataset.checksum,
            "dataset_version": dataset.version,
            "code_version": "1.0.0",
        }
    )

    job = TrainingJobModel(
        project_id=project_id,
        architecture_id=architecture.id,
        dataset_id=dataset.id,
        status="QUEUED",
        progress=0.0,
        hyperparameters=hyperparameters,
        cancel_requested=False,
        requested_by=user.id,
    )
    db.add(job)
    await db.flush()
    await record_audit(
        db,
        actor_id=user.id,
        action="TRAINING_JOB_QUEUED",
        project_id=project_id,
        metadata={
            "job_id": str(job.id),
            "architecture_id": str(architecture.id),
            "dataset_id": str(dataset.id),
            "epochs": hyperparameters.get("epochs"),
            "target_column": target,
            "task": task,
        },
    )
    await db.commit()

    try:
        await training_orchestrator.enqueue_training_job(
            job_id=job.id,
            project_id=project_id,
            architecture_id=architecture.id,
            dataset_id=dataset.id,
            hyperparameters=hyperparameters,
            architecture={
                "id": str(architecture.id),
                "name": architecture.name,
                "family": architecture.family,
                "config_json": architecture.config_json,
                "version": architecture.version,
            },
            dataset={
                "id": str(dataset.id),
                "name": dataset.name,
                "version": dataset.version,
                "original_filename": dataset.original_filename,
                "storage_key": dataset.storage_key,
                "checksum": dataset.checksum,
                "size_bytes": dataset.size_bytes,
                "target_column": dataset.target_column,
                "metadata_json": metadata,
            },
            target_column=target,
            task=task,
        )
    except QueueUnavailableError as exc:
        job.status = "FAILED"
        job.error_message = str(exc)
        job.ended_at = datetime.now(timezone.utc)
        await record_audit(
            db,
            actor_id=user.id,
            action="TRAINING_JOB_ENQUEUE_FAILED",
            project_id=project_id,
            metadata={"job_id": str(job.id), "error": str(exc)},
        )
        await db.commit()
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))

    await db.refresh(job)
    return await _serialize_job(db, job)


@router.get("/training-jobs/{job_id}", response_model=TrainingJobResponse)
async def get_training_job(
    job_id: UUID,
    user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    job, _ = await _job_with_access(db, job_id, user)
    return await _serialize_job(db, job)


@router.get("/training-jobs/{job_id}/metrics", response_model=List[TrainingMetricResponse])
async def get_training_metrics(
    job_id: UUID,
    user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _job_with_access(db, job_id, user)
    return (
        await db.scalars(
            select(TrainingMetricModel)
            .where(TrainingMetricModel.job_id == job_id)
            .order_by(TrainingMetricModel.epoch, TrainingMetricModel.metric_name)
        )
    ).all()


@router.post("/training-jobs/{job_id}/cancel", status_code=status.HTTP_202_ACCEPTED)
async def cancel_training_job(
    job_id: UUID,
    user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    job, _ = await _job_with_access(db, job_id, user, write=True)
    if job.status in TERMINAL_STATES:
        raise HTTPException(status_code=409, detail="El trabajo ya finalizó")
    if job.cancel_requested and job.status != "QUEUED":
        return {
            "message": "La cancelación ya fue solicitada",
            "status": job.status,
            "cancel_requested": True,
        }

    job.cancel_requested = True

    cancelled_in_queue = False
    if job.status == "QUEUED":
        # Aún no lo reclamó el worker: se cancela de inmediato. La transición es
        # condicional (UPDATE ... WHERE status='QUEUED') para que, si el worker lo
        # reclama a la vez, no se pisen mutuamente los estados.
        result = await db.execute(
            update(TrainingJobModel)
            .where(TrainingJobModel.id == job.id, TrainingJobModel.status == "QUEUED")
            .values(
                status="CANCELLED",
                cancel_requested=True,
                ended_at=datetime.now(timezone.utc),
            )
        )
        cancelled_in_queue = bool(result.rowcount)
        await db.refresh(job)

    if cancelled_in_queue:
        await record_audit(
            db,
            actor_id=user.id,
            action="TRAINING_JOB_CANCELLED",
            project_id=job.project_id,
            metadata={"job_id": str(job.id), "reason": "Cancelado antes de iniciar"},
        )
        await db.commit()
        try:
            await training_orchestrator.discard_job(job.id)
        except QueueUnavailableError as exc:
            job.error_message = f"Cancelado; limpieza de cola pendiente: {exc}"
            await db.commit()
        return {
            "message": "Trabajo cancelado antes de iniciar.",
            "status": "CANCELLED",
            "cancel_requested": True,
        }

    await record_audit(
        db,
        actor_id=user.id,
        action="TRAINING_JOB_CANCEL_REQUESTED",
        project_id=job.project_id,
        metadata={"job_id": str(job.id), "status": job.status},
    )
    await db.commit()

    try:
        await training_orchestrator.request_job_cancellation(job.id)
    except QueueUnavailableError as exc:
        # La solicitud quedó persistida; el worker la aplicará al reconectar.
        job.error_message = f"Cancelación persistida; notificación pendiente: {exc}"
        await db.commit()

    return {
        "message": "Solicitud de cancelación registrada. El worker confirmará el estado final.",
        "status": job.status,
        "cancel_requested": True,
    }


async def _event_user(request: Request, token: Optional[str], db: AsyncSession) -> UserModel:
    header = request.headers.get("authorization", "")
    bearer = header[7:] if header.lower().startswith("bearer ") else None
    resolved = bearer or token
    if not resolved:
        raise HTTPException(status_code=401, detail="Token requerido para el canal de eventos")
    payload = decode_access_token(resolved)
    user = await db.get(UserModel, UUID(payload["sub"]))
    if not user or user.status != "ACTIVE":
        raise HTTPException(status_code=401, detail="Usuario inválido")
    return user


async def _ticket_user(ticket: str, job_id: UUID, db: AsyncSession) -> UserModel:
    payload = await consume_stream_ticket(ticket=ticket, job_id=str(job_id))
    if not payload:
        raise HTTPException(
            status_code=401,
            detail="Ticket de eventos inválido, expirado o ya utilizado",
        )
    try:
        user_id = UUID(str(payload["user_id"]))
    except (KeyError, ValueError):
        raise HTTPException(status_code=401, detail="Ticket de eventos inválido")
    user = await db.get(UserModel, user_id)
    if not user or user.status != "ACTIVE":
        raise HTTPException(status_code=401, detail="Usuario inválido")
    return user


@router.get("/training-jobs/{job_id}/events")
async def stream_training_events(
    job_id: UUID,
    request: Request,
    ticket: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        user = await _event_user(request, None, db)
    elif ticket:
        user = await _ticket_user(ticket, job_id, db)
    else:
        raise HTTPException(
            status_code=401,
            detail="Se requiere un ticket de eventos o la cabecera Authorization",
        )
    await _job_with_access(db, job_id, user)
    return StreamingResponse(
        (format_sse(event) async for event in stream_job_events(job_id)),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/training-jobs/{job_id}/events-ticket")
async def create_training_events_ticket(
    job_id: UUID,
    user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Emite un ticket efímero para abrir SSE/WebSocket sin exponer el JWT."""
    await _job_with_access(db, job_id, user)
    ticket = await issue_stream_ticket(job_id=str(job_id), user_id=str(user.id))
    return {
        "ticket": ticket,
        "expires_in": max(5, settings.STREAM_TICKET_TTL_SECONDS),
    }


@router.websocket("/training-jobs/{job_id}/events/ws")
async def websocket_job_events(
    websocket: WebSocket, job_id: UUID, ticket: Optional[str] = Query(default=None)
):
    await websocket.accept()
    try:
        async with AsyncSessionLocal() as db:
            user = await _ticket_user(ticket or "", job_id, db)
            job = await db.get(TrainingJobModel, job_id)
            if not job:
                await websocket.close(code=4404)
                return
            await project_access(db, job.project_id, user)
    except HTTPException:
        await websocket.close(code=4401)
        return
    except Exception:
        await websocket.close(code=4400)
        return

    try:
        async for event in stream_job_events(job_id):
            await websocket.send_json(event)
    except WebSocketDisconnect:
        pass
    except Exception:
        try:
            await websocket.close()
        except Exception:
            logger.debug("El WebSocket ya estaba cerrado", exc_info=True)
