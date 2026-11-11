"""Entrenamiento real con callbacks de telemetría y cancelación cooperativa."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

import numpy as np
import tensorflow as tf

logger = logging.getLogger("neurolab.trainer")


@dataclass
class TrainingOutcome:
    status: str
    epochs_completed: int
    history: Dict[str, List[float]]
    duration_seconds: float = 0.0
    early_stopped: bool = False
    best_epoch: int = 0
    final_metrics: Dict[str, float] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.final_metrics is None:
            self.final_metrics = {}


class TelemetryCallback(tf.keras.callbacks.Callback):
    """Callback de Keras que persiste métricas y evalúa cancelación.

    La cancelación se comprueba al inicio y al final de cada época
    (cooperativa). Si se solicita, se detiene el entrenamiento sin destruir el
    proceso: el worker marca el trabajo como CANCELLED y conserva las métricas
    ya registradas.
    """

    def __init__(
        self,
        *,
        total_epochs: int,
        on_epoch: Callable[[int, Dict[str, float]], None],
        check_cancel: Callable[[], bool],
        timeout_seconds: int = 7200,
    ):
        super().__init__()
        self.total_epochs = max(1, int(total_epochs))
        self.on_epoch = on_epoch
        self.check_cancel = check_cancel
        self.timeout_seconds = int(timeout_seconds)
        self.cancelled = False
        self.timed_out = False
        self.epochs_completed = 0
        self._started = time.monotonic()

    def _should_stop(self) -> bool:
        if self.check_cancel():
            self.cancelled = True
            self.model.stop_training = True
            return True
        if self.timeout_seconds > 0 and (time.monotonic() - self._started) > self.timeout_seconds:
            self.timed_out = True
            self.model.stop_training = True
            return True
        return False

    def on_epoch_begin(self, epoch, logs=None):
        self._should_stop()

    def on_epoch_end(self, epoch, logs=None):
        logs = logs or {}
        self.epochs_completed = int(epoch) + 1
        clean_metrics: Dict[str, float] = {}
        for key, value in logs.items():
            try:
                clean_metrics[str(key)] = float(value)
            except (TypeError, ValueError):
                continue
        self.on_epoch(self.epochs_completed, clean_metrics)
        self._should_stop()


def train_model(
    model,
    *,
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_val: np.ndarray,
    y_val: np.ndarray,
    hyperparameters: Dict[str, Any],
    on_epoch: Callable[[int, Dict[str, float]], None],
    check_cancel: Callable[[], bool],
    class_weights: Optional[Dict[int, float]] = None,
) -> TrainingOutcome:
    epochs = int(hyperparameters.get("epochs", 30) or 30)
    batch_size = int(hyperparameters.get("batch_size", 32) or 32)

    callback = TelemetryCallback(
        total_epochs=epochs,
        on_epoch=on_epoch,
        check_cancel=check_cancel,
        timeout_seconds=int(hyperparameters.get("timeout_seconds", 7200) or 7200),
    )
    callbacks: List[Any] = [callback]

    early_stopping = None
    if hyperparameters.get("early_stopping", True):
        early_stopping = tf.keras.callbacks.EarlyStopping(
            monitor="val_loss",
            patience=int(hyperparameters.get("early_stopping_patience", 10) or 10),
            restore_best_weights=True,
            min_delta=1e-4,
        )
        callbacks.append(early_stopping)

    # ReduceLROnPlateau es una buena práctica por defecto: si la pérdida de
    # validación deja de mejorar, baja la tasa de aprendizaje en lugar de
    # seguir dando pasos grandes. Se puede desactivar explícitamente.
    if hyperparameters.get("reduce_lr_on_plateau", True):
        callbacks.append(
            tf.keras.callbacks.ReduceLROnPlateau(
                monitor="val_loss",
                factor=float(hyperparameters.get("lr_reduction_factor", 0.5) or 0.5),
                patience=int(hyperparameters.get("lr_reduction_patience", 5) or 5),
                min_lr=1e-6,
                verbose=0,
            )
        )
    callbacks.append(tf.keras.callbacks.TerminateOnNaN())

    if check_cancel():
        return TrainingOutcome(status="CANCELLED", epochs_completed=0, history={})

    applied_class_weights = {
        int(label): float(weight)
        for label, weight in (class_weights or {}).items()
    }
    if applied_class_weights:
        logger.info("Entrenando con pesos balanceados por clase: %s", applied_class_weights)

    started = time.monotonic()
    history = model.fit(
        X_train,
        y_train,
        validation_data=(X_val, y_val),
        epochs=epochs,
        batch_size=max(1, batch_size),
        verbose=0,
        shuffle=True,
        callbacks=callbacks,
        class_weight=applied_class_weights or None,
    )
    duration = time.monotonic() - started

    if callback.cancelled:
        status = "CANCELLED"
    elif callback.timed_out:
        status = "TIMEOUT"
    else:
        status = "COMPLETED"

    recorded = {
        key: [float(value) for value in values]
        for key, values in (history.history or {}).items()
    }
    val_losses = recorded.get("val_loss") or []
    best_epoch = (int(np.argmin(val_losses)) + 1) if val_losses else callback.epochs_completed
    early_stopped = bool(
        early_stopping is not None and getattr(early_stopping, "stopped_epoch", 0) > 0
    )
    final_metrics = {
        key: float(values[-1]) for key, values in recorded.items() if values
    }

    logger.info(
        "Entrenamiento finalizado con estado=%s tras %s épocas en %.1fs (early_stopped=%s)",
        status,
        callback.epochs_completed,
        duration,
        early_stopped,
    )
    return TrainingOutcome(
        status=status,
        epochs_completed=callback.epochs_completed,
        history=recorded,
        duration_seconds=round(duration, 3),
        early_stopped=early_stopped,
        best_epoch=best_epoch,
        final_metrics=final_metrics,
    )
