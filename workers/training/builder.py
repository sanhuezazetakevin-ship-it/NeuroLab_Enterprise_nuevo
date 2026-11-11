"""Construcción de modelos Keras a partir de la topología validada por la API."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger("neurolab.builder")


class ModelBuildError(ValueError):
    """Error de construcción con un mensaje apto para el usuario."""


class KerasModelBuilder:
    """Construye un modelo Feedforward real para el MVP tabular.

    La capa de salida se adapta automáticamente al tipo de tarea detectado en
    el dataset (binaria, multiclase o regresión). Esto evita incongruencias
    entre la topología guardada y las etiquetas reales.
    """

    @staticmethod
    def build_model(
        *,
        config: Dict[str, Any],
        family: str,
        input_dim: int,
        output_units: int,
        output_activation: str,
        loss: str,
        metrics: List[str],
        hyperparameters: Dict[str, Any],
    ):
        try:
            import tensorflow as tf
            from tensorflow.keras import layers, models, optimizers
        except ImportError as exc:  # pragma: no cover - entorno sin TF
            raise ModelBuildError(
                "TensorFlow/Keras no está disponible en el worker. Instale las dependencias de entrenamiento."
            ) from exc

        family_upper = (family or "FEEDFORWARD").upper()
        if family_upper not in {"FEEDFORWARD", "RNN", "CNN"}:
            raise ModelBuildError(
                f"La familia {family_upper or 'desconocida'} no está habilitada para entrenamiento. "
                "Familias soportadas: FEEDFORWARD, RNN, CNN."
            )

        declared_shape = config.get("input_shape")
        if declared_shape:
            try:
                declared_dims = [int(dimension) for dimension in declared_shape]
            except (TypeError, ValueError) as exc:
                raise ModelBuildError(
                    "El input_shape debe ser una lista de dimensiones numéricas"
                ) from exc
            if any(dimension <= 0 for dimension in declared_dims):
                raise ModelBuildError("El input_shape debe contener dimensiones positivas")
            if declared_dims[0] != int(input_dim):
                raise ModelBuildError(
                    f"El input_shape declarado {declared_dims} no coincide con las "
                    f"{input_dim} características del dataset tras el preprocesamiento"
                )

        raw_seed = hyperparameters.get("random_seed")
        seed = 42 if raw_seed is None else int(raw_seed)
        tf.keras.utils.set_random_seed(seed)

        raw_layers = config.get("layers", [])
        if not raw_layers:
            raise ModelBuildError("La arquitectura no contiene capas")

        model_name = f"neurolab_{family_upper.lower()}"
        model = models.Sequential(name=model_name)
        model.add(layers.Input(shape=(input_dim,), name="features"))

        # Adaptadores para secuencias y convoluciones en datos tabulares
        if family_upper == "RNN":
            model.add(layers.Reshape((input_dim, 1), name="tabular_sequence_adapter"))
        elif family_upper == "CNN":
            model.add(layers.Reshape((input_dim, 1), name="tabular_conv_adapter"))

        last_index = len(raw_layers) - 1
        output_defined = False
        for index, layer_config in enumerate(raw_layers):
            layer_type = str(layer_config.get("type", "")).strip()
            activation = str(layer_config.get("activation") or "relu").lower()
            is_last = index == last_index

            if layer_type == "Dense":
                units = int(output_units) if is_last else int(layer_config.get("units") or 32)
                if units <= 0:
                    raise ModelBuildError(f"Capa {index}: las unidades de Dense deben ser mayores que cero")
                use_activation: Optional[str] = output_activation if is_last else activation
                if use_activation == "leaky_relu":
                    model.add(layers.Dense(units=units, activation=None, name=f"dense_{index}"))
                    model.add(layers.LeakyReLU(negative_slope=0.01))
                else:
                    model.add(layers.Dense(units=units, activation=use_activation, name=f"dense_{index}"))
                if is_last:
                    output_defined = True

            elif layer_type in {"LSTM", "GRU", "SimpleRNN"}:
                units = int(layer_config.get("units") or 32)
                return_seq = bool(layer_config.get("return_sequences") or layer_config.get("returnSequences", False))
                # Si es la última capa antes de la salida, aplanamos para alimentar Dense
                if is_last or (index == last_index - 1 and raw_layers[-1].get("type") == "Dense"):
                    return_seq = False
                rnn_cls = getattr(layers, layer_type)
                model.add(rnn_cls(units=units, return_sequences=return_seq, name=f"{layer_type.lower()}_{index}"))

            elif layer_type == "Conv1D":
                filters = int(layer_config.get("filters") or 32)
                k_size = layer_config.get("kernel_size") or layer_config.get("kernelSize") or 3
                if isinstance(k_size, list):
                    k_size = k_size[0]
                k_size = max(1, min(int(k_size), input_dim))
                model.add(layers.Conv1D(filters=filters, kernel_size=k_size, activation=activation, padding="same", name=f"conv1d_{index}"))

            elif layer_type == "MaxPooling1D":
                pool_size = layer_config.get("pool_size") or layer_config.get("poolSize") or 2
                if isinstance(pool_size, list):
                    pool_size = pool_size[0]
                model.add(layers.MaxPooling1D(pool_size=int(pool_size), padding="same", name=f"maxpool_{index}"))

            elif layer_type in {"Conv2D", "MaxPooling2D"}:
                raise ModelBuildError(
                    f"Capa {index}: '{layer_type}' no está soportada para datos tabulares. "
                    "Use Conv1D/MaxPooling1D para características tabulares."
                )

            elif layer_type == "Flatten":
                model.add(layers.Flatten(name=f"flatten_{index}"))

            elif layer_type == "Dropout":
                rate = float(layer_config.get("rate", 0.2) or 0.2)
                if not 0.0 <= rate < 1.0:
                    raise ModelBuildError(f"Capa {index}: la tasa de Dropout debe estar en [0, 1)")
                model.add(layers.Dropout(rate=rate, name=f"dropout_{index}"))

            elif layer_type == "BatchNormalization":
                model.add(layers.BatchNormalization(name=f"batchnorm_{index}"))

            else:
                raise ModelBuildError(
                    f"Capa {index}: tipo de capa '{layer_type}' no soportado para la familia {family_upper}"
                )

        if not output_defined:
            if output_activation == "leaky_relu":
                model.add(layers.Dense(units=int(output_units), activation=None, name="output"))
                model.add(layers.LeakyReLU(negative_slope=0.01))
            else:
                model.add(
                    layers.Dense(
                        units=int(output_units),
                        activation=output_activation,
                        name="output",
                    )
                )

        optimizer_name = str(hyperparameters.get("optimizer", "adam")).lower()
        learning_rate = float(hyperparameters.get("learning_rate", 0.001))
        optimizer_map = {
            "adam": optimizers.Adam,
            "sgd": optimizers.SGD,
            "rmsprop": optimizers.RMSprop,
            "adamw": optimizers.AdamW,
            "nadam": optimizers.Nadam,
        }
        optimizer_cls = optimizer_map.get(optimizer_name)
        if optimizer_cls is None:
            raise ModelBuildError(
                f"Optimizador no soportado: '{optimizer_name}'. "
                "Use uno de: adam, sgd, rmsprop, adamw, nadam."
            )
        optimizer = optimizer_cls(learning_rate=learning_rate)

        model.compile(optimizer=optimizer, loss=loss, metrics=list(metrics))
        logger.info(
            "Modelo Keras compilado: %s parámetros, salida=%s/%s, pérdida=%s",
            model.count_params(),
            output_units,
            output_activation,
            loss,
        )
        return model
