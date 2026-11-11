from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.core.database import get_db
from app.core.deps import WRITE_ROLES, ensure_project_role, get_current_user, project_access
from app.core.storage import StorageError, storage
from app.modules.audit.service import record_audit
from app.modules.datasets.service import build_preview, create_dataset_from_upload
from app.repositories.models import DatasetModel, TrainingJobModel, UserModel
from app.schemas.dataset import DatasetPreview, DatasetResponse

router = APIRouter(prefix="/projects/{project_id}/datasets", tags=["Datasets"])


@router.get("", response_model=List[DatasetResponse])
async def list_datasets(
    project_id: UUID,
    user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await project_access(db, project_id, user)
    return (
        await db.scalars(
            select(DatasetModel)
            .where(DatasetModel.project_id == project_id)
            .order_by(DatasetModel.created_at.desc())
        )
    ).all()


@router.post("/upload", response_model=DatasetResponse, status_code=status.HTTP_201_CREATED)
async def upload_dataset(
    project_id: UUID,
    file: UploadFile = File(...),
    name: Optional[str] = Form(default=None),
    target_column: Optional[str] = Form(default=None),
    user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _, role = await project_access(db, project_id, user)
    ensure_project_role(role, WRITE_ROLES, "cargar datasets")

    dataset = await create_dataset_from_upload(
        db,
        project_id=project_id,
        file=file,
        name=name,
        target_column=target_column,
        created_by=user.id,
    )
    await record_audit(
        db,
        actor_id=user.id,
        action="DATASET_UPLOADED",
        project_id=project_id,
        metadata={
            "dataset_id": str(dataset.id),
            "filename": dataset.original_filename,
            "rows": dataset.metadata_json.get("samples"),
            "checksum": dataset.checksum,
        },
    )
    await db.commit()
    await db.refresh(dataset)
    return dataset


@router.get("/{dataset_id}", response_model=DatasetResponse)
async def get_dataset(
    project_id: UUID,
    dataset_id: UUID,
    user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await project_access(db, project_id, user)
    dataset = await db.get(DatasetModel, dataset_id)
    if not dataset or dataset.project_id != project_id:
        raise HTTPException(status_code=404, detail="Dataset no encontrado")
    return dataset


@router.get("/{dataset_id}/preview", response_model=DatasetPreview)
async def preview_dataset(
    project_id: UUID,
    dataset_id: UUID,
    user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await project_access(db, project_id, user)
    dataset = await db.get(DatasetModel, dataset_id)
    if not dataset or dataset.project_id != project_id:
        raise HTTPException(status_code=404, detail="Dataset no encontrado")
    try:
        content = await run_in_threadpool(storage.get_bytes, dataset.storage_key)
    except StorageError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    columns, dtypes, rows, total_rows, null_counts = await run_in_threadpool(
        build_preview, content, dataset.metadata_json or {}
    )
    return DatasetPreview(
        id=dataset.id,
        columns=columns,
        dtypes=dtypes,
        rows=rows,
        total_rows=total_rows,
        null_counts=null_counts,
    )


@router.delete("/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dataset(
    project_id: UUID,
    dataset_id: UUID,
    user: UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _, role = await project_access(db, project_id, user)
    ensure_project_role(role, WRITE_ROLES, "eliminar datasets")
    dataset = await db.get(DatasetModel, dataset_id)
    if not dataset or dataset.project_id != project_id:
        raise HTTPException(status_code=404, detail="Dataset no encontrado")

    jobs = await db.scalar(
        select(func.count())
        .select_from(TrainingJobModel)
        .where(TrainingJobModel.dataset_id == dataset_id)
    )
    if jobs:
        raise HTTPException(
            status_code=409,
            detail="No se puede eliminar un dataset referenciado por entrenamientos (trazabilidad)",
        )

    try:
        await run_in_threadpool(storage.delete, dataset.storage_key)
    except StorageError:
        pass
    await record_audit(
        db,
        actor_id=user.id,
        action="DATASET_DELETED",
        project_id=project_id,
        metadata={"dataset_id": str(dataset.id), "filename": dataset.original_filename},
    )
    await db.delete(dataset)
    await db.commit()
