"""Captura del entorno de ejecución para el manifiesto del experimento.

Sin esta información un resultado no es auditable: dos entornos con versiones
distintas de Keras o de scikit-learn pueden producir modelos diferentes con el
mismo código. Se usan ``importlib.metadata`` para leer versiones sin importar
los paquetes (importar TensorFlow solo para leer su versión costaría segundos).
"""

from __future__ import annotations

import logging
import os
import platform
import subprocess
import sys
from importlib import metadata
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger("neurolab.environment")

RELEVANT_PACKAGES = (
    "tensorflow",
    "keras",
    "numpy",
    "pandas",
    "scikit-learn",
    "scipy",
    "sqlalchemy",
    "joblib",
)


def _package_version(name: str) -> Optional[str]:
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return None
    except Exception:  # pragma: no cover - metadatos corruptos
        return None


def _git_commit(start: Path | None = None) -> Optional[str]:
    """Devuelve el commit actual si el repositorio está disponible en la imagen."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(start or Path(__file__).resolve().parent),
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            return result.stdout.strip() or None
    except Exception:
        return None
    return None


def capture_environment() -> Dict[str, Any]:
    versions = {name: _package_version(name) for name in RELEVANT_PACKAGES}
    return {
        "python": sys.version.split()[0],
        "implementation": platform.python_implementation(),
        "platform": platform.platform(),
        "machine": platform.machine(),
        "processor": platform.processor() or None,
        "cpu_count": os.cpu_count(),
        "packages": {name: version for name, version in versions.items() if version},
        "git_commit": _git_commit(),
    }
