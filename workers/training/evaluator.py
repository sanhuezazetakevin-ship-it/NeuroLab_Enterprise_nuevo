"""Evaluación final real sobre el conjunto de prueba reservado.

La evaluación es el único punto donde el modelo ve el ``X_test``. Todas las
métricas se calculan con :mod:`metrics`, la misma función que se usa para los
baselines, de modo que la comparación es homogénea.
"""

from __future__ import annotations

import logging
from typing import Any, Dict

import numpy as np

from metrics import classification_metrics, regression_metrics

logger = logging.getLogger("neurolab.evaluator")


class ModelEvaluator:
    @staticmethod
    def evaluate(model, data) -> Dict[str, Any]:
        logger.info(
            "Ejecutando evaluación final sobre %s muestras de prueba",
            data.samples_test,
        )
        raw = model.evaluate(data.X_test, data.y_test, verbose=0, return_dict=True)

        if data.task == "classification":
            probabilities = np.asarray(
                model.predict(data.X_test, verbose=0)
            )
            metrics: Dict[str, Any] = classification_metrics(
                data.y_test,
                probabilities,
                class_labels=data.class_labels,
                output_units=data.output_units,
            )
            # Alias conservados para el contrato previo del frontend.
            metrics["test_accuracy"] = metrics.get("accuracy")
            metrics["class_labels"] = list(data.class_labels)
        else:
            predictions = np.asarray(
                model.predict(data.X_test, verbose=0)
            ).reshape(-1)
            metrics = regression_metrics(data.y_test, predictions)

        metrics["test_loss"] = float(raw.get("loss", 0.0))
        metrics["samples_test"] = int(data.samples_test)
        return metrics

    @staticmethod
    def predictions(model, data):
        """Devuelve las predicciones crudas del modelo sobre el conjunto de prueba."""
        return np.asarray(model.predict(data.X_test, verbose=0))
