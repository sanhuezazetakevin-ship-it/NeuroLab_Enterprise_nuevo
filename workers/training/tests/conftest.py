"""Configuración de las pruebas del núcleo de Machine Learning del worker.

Las pruebas son herméticas: redirigen los directorios de trabajo a un tmp y no
dependen de que exista un ``.env`` en el repositorio.
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

WORKER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER_DIR))

_TEST_ROOT = Path(tempfile.mkdtemp(prefix="neurolab_worker_tests_"))

# Se asignan (no setdefault) antes de importar worker_config, que ejecuta
# load_dotenv sin sobrescribir variables ya presentes en el entorno.
os.environ["DATA_DIR"] = str(_TEST_ROOT / "uploads")
os.environ["MODEL_DIR"] = str(_TEST_ROOT / "models")
os.environ["TEMP_DIR"] = str(_TEST_ROOT / "tmp")
os.environ["QUEUE_BACKEND"] = "filesystem"
# Aislamiento estricto: ningún test debe poder conectarse a la BD del .env.
os.environ["DATABASE_URL"] = f"sqlite:///{(_TEST_ROOT / 'worker.db').as_posix()}"
