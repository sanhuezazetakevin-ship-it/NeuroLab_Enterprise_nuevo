from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

JobStatus = Literal["QUEUED", "PREPARING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"]
TaskType = Literal["classification", "regression"]


class HyperparametersConfig(BaseModel):
    epochs: int = Field(default=30, ge=1, le=1000)
    batch_size: int = Field(default=32, ge=1, le=4096)
    optimizer: Literal["adam", "sgd", "rmsprop", "adamw", "nadam"] = "adam"
    learning_rate: float = Field(default=0.001, gt=0.0, le=1.0)
    loss: Optional[str] = None
    metrics: List[str] = Field(default_factory=lambda: ["accuracy"])
    random_seed: int = Field(default=42, ge=0, le=2**31 - 1)
    validation_split: float = Field(default=0.15, gt=0.0, lt=0.5)
    # Control de entrenamiento reproducible y regularización.
    deterministic: bool = True
    early_stopping: bool = True
    early_stopping_patience: int = Field(default=10, ge=1, le=100)
    reduce_lr_on_plateau: bool = True

    @field_validator("optimizer", mode="before")
    @classmethod
    def _lower_optimizer(cls, value):
        return value.lower() if isinstance(value, str) else value


class TrainingJobCreate(BaseModel):
    architecture_id: UUID
    dataset_id: UUID
    target_column: Optional[str] = Field(default=None, max_length=150)
    task: Optional[TaskType] = None
    hyperparameters: HyperparametersConfig


class TrainingMetricResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    job_id: UUID
    epoch: int
    metric_name: str
    metric_value: float
    recorded_at: datetime


class TrainingJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    architecture_id: UUID
    dataset_id: UUID
    status: JobStatus
    progress: float
    hyperparameters: Dict[str, Any]
    cancel_requested: bool = False
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    error_message: Optional[str] = None
    created_at: datetime
    metrics: List[Dict[str, Any]] = Field(default_factory=list)


class TrainingJobCreatedResponse(BaseModel):
    job_id: UUID
    status: JobStatus
    created_at: datetime
