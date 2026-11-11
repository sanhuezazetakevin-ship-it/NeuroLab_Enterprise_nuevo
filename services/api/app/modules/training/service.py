from typing import Any, Dict, Optional
from uuid import UUID

from app.modules.training.queue import QueueUnavailableError, training_queue


class TrainingOrchestrator:
    """Orquesta el despacho de trabajos hacia el worker asíncrono."""

    async def enqueue_training_job(
        self,
        *,
        job_id: UUID,
        project_id: UUID,
        architecture_id: UUID,
        dataset_id: UUID,
        hyperparameters: Dict[str, Any],
        architecture: Dict[str, Any],
        dataset: Dict[str, Any],
        target_column: Optional[str],
        task: Optional[str],
    ) -> bool:
        payload = {
            "job_id": str(job_id),
            "project_id": str(project_id),
            "architecture_id": str(architecture_id),
            "dataset_id": str(dataset_id),
            "hyperparameters": hyperparameters,
            "architecture": architecture,
            "dataset": dataset,
            "target_column": target_column,
            "task": task,
        }
        await training_queue.enqueue(payload)
        return True

    async def request_job_cancellation(self, job_id: UUID) -> bool:
        await training_queue.request_cancel(str(job_id))
        return True

    async def discard_job(self, job_id: UUID) -> bool:
        """Quita de la cola un trabajo cancelado antes de ser reclamado."""
        await training_queue.discard_job(str(job_id))
        return True


training_orchestrator = TrainingOrchestrator()
__all__ = ["TrainingOrchestrator", "training_orchestrator", "QueueUnavailableError"]
