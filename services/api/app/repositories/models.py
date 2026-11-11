import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB

from app.core.database import Base

JSONType = JSON().with_variant(JSONB, "postgresql")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UserModel(Base):
    __tablename__ = "users"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    display_name = Column(String(150), nullable=False)
    role = Column(String(50), nullable=False, default="AI_ENGINEER")
    status = Column(String(50), nullable=False, default="ACTIVE")
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)


class ProjectModel(Base):
    __tablename__ = "projects"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    owner_id = Column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    status = Column(String(50), nullable=False, default="ACTIVE")
    # Tipo de red elegido al crear el proyecto. Actúa como valor por defecto
    # del diseñador; un proyecto puede contener arquitecturas de otras familias.
    network_family = Column(
        String(50), nullable=False, default="FEEDFORWARD", server_default="FEEDFORWARD"
    )
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    __table_args__ = (Index("idx_projects_owner", "owner_id"),)


class ProjectMemberModel(Base):
    __tablename__ = "project_members"

    project_id = Column(
        Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True
    )
    user_id = Column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    role = Column(String(50), nullable=False, default="AI_ENGINEER")
    added_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)


class DatasetModel(Base):
    __tablename__ = "datasets"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(
        Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    name = Column(String(200), nullable=False)
    version = Column(String(50), nullable=False, default="v1.0")
    storage_key = Column(String(500), nullable=False)
    original_filename = Column(String(255), nullable=False)
    size_bytes = Column(Integer, nullable=False, default=0)
    checksum = Column(String(128), nullable=False, default="")
    target_column = Column(String(150), nullable=True)
    verified = Column(Boolean, nullable=False, default=False)
    metadata_json = Column(JSONType, nullable=False, default=dict)
    created_by = Column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    __table_args__ = (Index("idx_datasets_project", "project_id"),)


class ArchitectureModel(Base):
    __tablename__ = "architectures"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(
        Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    name = Column(String(200), nullable=False)
    family = Column(String(50), nullable=False)
    config_json = Column(JSONType, nullable=False)
    version = Column(Integer, nullable=False, default=1)
    created_by = Column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    __table_args__ = (Index("idx_architectures_project", "project_id"),)


class TrainingJobModel(Base):
    __tablename__ = "training_jobs"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(
        Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    architecture_id = Column(
        Uuid(as_uuid=True), ForeignKey("architectures.id", ondelete="RESTRICT"), nullable=False
    )
    dataset_id = Column(
        Uuid(as_uuid=True), ForeignKey("datasets.id", ondelete="RESTRICT"), nullable=False
    )
    status = Column(String(50), nullable=False, default="QUEUED")
    progress = Column(Float, nullable=False, default=0.0)
    hyperparameters = Column(JSONType, nullable=False, default=dict)
    cancel_requested = Column(Boolean, nullable=False, default=False)
    requested_by = Column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    error_message = Column(Text, nullable=True)
    worker_id = Column(String(150), nullable=True)
    heartbeat_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    __table_args__ = (
        Index("idx_training_jobs_project", "project_id"),
        Index("idx_training_jobs_status", "status"),
    )


class TrainingMetricModel(Base):
    __tablename__ = "training_metrics"

    id = Column(Integer, primary_key=True, autoincrement=True)
    job_id = Column(
        Uuid(as_uuid=True), ForeignKey("training_jobs.id", ondelete="CASCADE"), nullable=False
    )
    epoch = Column(Integer, nullable=False)
    metric_name = Column(String(100), nullable=False)
    metric_value = Column(Float, nullable=False)
    recorded_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    __table_args__ = (
        Index("idx_metrics_job_epoch", "job_id", "epoch"),
        UniqueConstraint("job_id", "epoch", "metric_name", name="uq_metric_job_epoch_name"),
    )


class ModelVersionModel(Base):
    __tablename__ = "model_versions"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(
        Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    job_id = Column(
        Uuid(as_uuid=True), ForeignKey("training_jobs.id", ondelete="RESTRICT"), nullable=False
    )
    version = Column(String(50), nullable=False)
    storage_key = Column(String(500), nullable=False)
    status = Column(String(50), nullable=False, default="DRAFT")
    checksum = Column(String(128), nullable=False)
    metrics_summary = Column(JSONType, nullable=True, default=dict)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    __table_args__ = (
        Index("idx_model_versions_project", "project_id"),
        UniqueConstraint("project_id", "version", name="uq_model_versions_project_version"),
    )


class AuditEventModel(Base):
    __tablename__ = "audit_events"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor_id = Column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    project_id = Column(
        Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="SET NULL"), nullable=True
    )
    action = Column(String(100), nullable=False)
    metadata_json = Column(JSONType, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    __table_args__ = (
        Index("idx_audit_events_project", "project_id"),
        Index("idx_audit_events_actor", "actor_id"),
    )
