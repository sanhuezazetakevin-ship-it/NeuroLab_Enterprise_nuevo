"""Control de reproducibilidad de los entrenamientos.

Un experimento es reproducible cuando, con el mismo dataset, la misma
arquitectura y los mismos hiperparámetros, se obtiene el mismo modelo. En
TensorFlow eso exige tres cosas distintas:

1. Sembrar todos los generadores (Python, numpy y Keras).
2. Activar el determinismo de operaciones, que elimina el no determinismo de
   algunas rutinas paralelas (reducciones, orden de ejecución en hilos).
3. Fijar ``PYTHONHASHSEED`` **antes** de arrancar el proceso; en caliente no
   tiene efecto, por eso se reporta su valor real en el manifiesto.

El determinismo tiene un coste de rendimiento, por lo que se puede desactivar
con el hiperparámetro ``deterministic=false``. El manifiesto registra en todos
los casos qué configuración se aplicó, para que la ausencia de reproducibilidad
sea explícita y no un accidente.
"""

from __future__ import annotations

import logging
import os
import random
from typing import Any, Dict

import numpy as np

logger = logging.getLogger("neurolab.reproducibility")

# ``enable_op_determinism`` es global al proceso y no se puede desactivar.
# Se guarda el estado real para informarlo con honestidad en cada manifiesto,
# incluso cuando un trabajo pidió no ser determinista pero el proceso ya lo era.
_DETERMINISM_STATE = {"enabled": False}


def configure_determinism(seed: int, *, deterministic: bool = True) -> Dict[str, Any]:
    """Siembra los generadores y, opcionalmente, activa el determinismo de TF."""
    seed = int(seed)
    random.seed(seed)
    np.random.seed(seed % (2**32))

    report: Dict[str, Any] = {
        "random_seed": seed,
        "deterministic_ops": _DETERMINISM_STATE["enabled"],
        "deterministic_requested": bool(deterministic),
        "python_hash_seed": os.environ.get("PYTHONHASHSEED"),
    }

    try:
        import tensorflow as tf
    except ImportError:  # pragma: no cover - entorno sin TensorFlow
        report["tensorflow_available"] = False
        return report

    report["tensorflow_available"] = True
    tf.keras.utils.set_random_seed(seed)

    if deterministic and not _DETERMINISM_STATE["enabled"]:
        try:
            tf.config.experimental.enable_op_determinism()
            _DETERMINISM_STATE["enabled"] = True
            report["deterministic_ops"] = True
        except Exception as exc:  # pragma: no cover - depende de la plataforma
            logger.warning("No fue posible activar el determinismo de TensorFlow: %s", exc)
            report["deterministic_error"] = str(exc)

    return report
