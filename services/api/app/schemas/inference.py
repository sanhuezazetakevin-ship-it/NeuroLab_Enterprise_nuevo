from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class PredictionRequest(BaseModel):
    records: List[Dict[str, Any]] = Field(
        min_length=1,
        max_length=1000,
        description="Lista de registros con las mismas columnas usadas en el entrenamiento.",
    )
    threshold: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description=(
            "Umbral de decisión para clasificación binaria. Si se omite se usa el "
            "umbral ajustado durante la evaluación del modelo."
        ),
    )


class PredictionItem(BaseModel):
    index: int
    prediction: Any
    label: Optional[str] = None
    probability: Optional[float] = None
    probabilities: Optional[Dict[str, float]] = None
    threshold: Optional[float] = None


class PredictionResponse(BaseModel):
    model_id: UUID
    model_version: str
    model_status: str
    task: str
    target_column: Optional[str] = None
    class_labels: List[str] = Field(default_factory=list)
    decision_threshold: Optional[float] = None
    predictions: List[PredictionItem]
    warnings: List[str] = Field(default_factory=list)
