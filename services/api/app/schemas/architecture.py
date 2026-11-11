from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

ArchitectureFamily = str  # FEEDFORWARD | RNN | CNN | GAN (validado en el validador)

SUPPORTED_ACTIVATIONS = {
    "relu",
    "sigmoid",
    "tanh",
    "softmax",
    "linear",
    "leaky_relu",
    "elu",
    "swish",
}


class LayerConfig(BaseModel):
    id: Optional[str] = None
    type: str = Field(description="Dense, Dropout, Conv2D, MaxPooling2D, Flatten, LSTM, GRU, BatchNormalization")
    units: Optional[int] = Field(default=None, gt=0, le=100_000)
    activation: Optional[str] = None
    rate: Optional[float] = Field(default=None, ge=0.0, lt=1.0)
    filters: Optional[int] = Field(default=None, gt=0, le=4096)
    kernel_size: Optional[List[int]] = None
    pool_size: Optional[List[int]] = None
    return_sequences: Optional[bool] = None

    @field_validator("kernel_size", "pool_size", mode="before")
    @classmethod
    def _normalize_size_list(cls, value):
        if isinstance(value, int):
            return [value]
        return value

    @field_validator("activation")
    @classmethod
    def _activation_supported(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        normalized = value.strip().lower()
        if normalized not in SUPPORTED_ACTIVATIONS:
            raise ValueError(
                f"Función de activación no soportada: {value}. Use: {sorted(SUPPORTED_ACTIVATIONS)}"
            )
        return normalized


class NetworkTopology(BaseModel):
    input_shape: List[int]
    layers: List[LayerConfig]


class ArchitectureBase(BaseModel):
    name: str = Field(min_length=3, max_length=200)
    family: str = Field(pattern="^(FEEDFORWARD|RNN|CNN|GAN)$")
    config_json: NetworkTopology


class ArchitectureCreate(ArchitectureBase):
    pass


class ArchitectureValidationResult(BaseModel):
    valid: bool
    total_parameters: int
    trainable_parameters: int
    output_shape: List[Optional[int]]
    warnings: List[str] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)
    trainable: bool = True
    trainable_reason: Optional[str] = None


class ArchitectureResponse(ArchitectureBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    version: int
    created_at: datetime
