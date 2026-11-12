from typing import List, Optional

from app.schemas.architecture import ArchitectureValidationResult, NetworkTopology

FAMILIES = {"FEEDFORWARD", "RNN", "CNN", "GAN"}
LAYER_TYPES = {
    "Dense",
    "Dropout",
    "Conv1D",
    "Conv2D",
    "MaxPooling1D",
    "MaxPooling2D",
    "Flatten",
    "LSTM",
    "GRU",
    "SimpleRNN",
    "BatchNormalization",
}
FAMILY_LAYERS = {
    "FEEDFORWARD": {"Dense", "Dropout", "BatchNormalization"},
    "RNN": {"Dense", "Dropout", "BatchNormalization", "LSTM", "GRU", "SimpleRNN"},
    "CNN": {"Dense", "Dropout", "BatchNormalization", "Conv1D", "Conv2D", "MaxPooling1D", "MaxPooling2D", "Flatten"},
    "GAN": {"Dense", "Dropout", "BatchNormalization", "Conv1D", "Conv2D", "MaxPooling1D", "MaxPooling2D", "Flatten"},
}


class ArchitectureValidator:
    """Validación dimensional y de compatibilidad por familia.

    El frontend nunca es la frontera de seguridad: esta validación se ejecuta
    tanto al guardar una arquitectura como al encolar un entrenamiento.
    """

    @staticmethod
    def validate_topology(topology: NetworkTopology, family: str) -> ArchitectureValidationResult:
        family = (family or "").upper()
        errors: List[str] = []
        warnings: List[str] = []

        if family not in FAMILIES:
            return ArchitectureValidationResult(
                valid=False,
                total_parameters=0,
                trainable_parameters=0,
                output_shape=[],
                errors=[f"Familia de red no soportada: '{family}'. Use {sorted(FAMILIES)}."],
                trainable=False,
                trainable_reason="Familia desconocida",
            )

        if not topology.input_shape or any(dim <= 0 for dim in topology.input_shape):
            return ArchitectureValidationResult(
                valid=False,
                total_parameters=0,
                trainable_parameters=0,
                output_shape=[],
                errors=["El input_shape debe contener dimensiones positivas válidas."],
                trainable=False,
                trainable_reason="Forma de entrada inválida",
            )

        if not topology.layers:
            return ArchitectureValidationResult(
                valid=False,
                total_parameters=0,
                trainable_parameters=0,
                output_shape=[],
                errors=["La arquitectura debe contener al menos una capa."],
                trainable=False,
                trainable_reason="Arquitectura vacía",
            )

        if family == "FEEDFORWARD" and len(topology.input_shape) != 1:
            errors.append(
                f"FEEDFORWARD espera un vector 1D de características [features]. Recibido: {topology.input_shape}."
            )
        if family == "RNN" and len(topology.input_shape) not in {1, 2}:
            errors.append(
                f"RNN espera [features] o [timesteps, features]. Recibido: {topology.input_shape}."
            )
        if family == "CNN" and len(topology.input_shape) not in {1, 2, 3}:
            errors.append(
                f"CNN espera [features], [timesteps, features] o [alto, ancho, canales]. Recibido: {topology.input_shape}."
            )

        current_shape = list(topology.input_shape)
        # El worker adapta los datos tabulares a (features, 1) antes de las capas
        # recurrentes/convolucionales; reflejamos esa forma para no contar
        # parámetros con dimensiones que el modelo real no tendrá.
        if family in {"RNN", "CNN"}:
            current_shape = [current_shape[0], 1]
        total_params = 0
        trainable_params = 0

        for idx, layer in enumerate(topology.layers):
            l_type = layer.type.strip()
            if l_type not in LAYER_TYPES:
                errors.append(f"Capa {idx}: tipo de capa '{l_type}' no soportado.")
                continue
            if l_type not in FAMILY_LAYERS[family]:
                errors.append(
                    f"Capa {idx} ({l_type}): incompatible con la familia {family}."
                )
                continue

            if family == "CNN" and l_type in {"Conv2D", "MaxPooling2D"}:
                errors.append(
                    f"Capa {idx} ({l_type}): las capas 2D no aplican a datos tabulares; "
                    "use Conv1D/MaxPooling1D."
                )
                continue

            if l_type == "Dense":
                if not layer.units or layer.units <= 0:
                    errors.append(f"Capa {idx} (Dense): las unidades deben ser > 0.")
                    continue
                if len(current_shape) > 1:
                    errors.append(
                        f"Capa {idx} (Dense): requiere entrada 2D; agregue Flatten/GlobalPooling antes "
                        f"(forma actual {current_shape})."
                    )
                    continue

                input_features = current_shape[-1]
                layer_params = (input_features + 1) * layer.units
                total_params += layer_params
                trainable_params += layer_params
                current_shape = [layer.units]

            elif l_type == "Dropout":
                rate = layer.rate if layer.rate is not None else 0.5
                if not (0.0 <= rate < 1.0):
                    errors.append(f"Capa {idx} (Dropout): la tasa debe estar en [0, 1).")

            elif l_type == "Conv1D":
                if len(current_shape) not in {1, 2}:
                    errors.append(
                        f"Capa {idx} (Conv1D): requiere [features] o [steps, channels]. "
                        f"Actual: {current_shape}."
                    )
                    continue
                filters = layer.filters or 32
                if filters <= 0:
                    errors.append(f"Capa {idx} (Conv1D): filters debe ser > 0.")
                    continue
                raw_kernel = layer.kernel_size or [3]
                if not isinstance(raw_kernel, list):
                    raw_kernel = [raw_kernel]
                if len(raw_kernel) != 1 or int(raw_kernel[0]) <= 0:
                    errors.append(f"Capa {idx} (Conv1D): kernel_size inválido.")
                    continue
                kernel = int(raw_kernel[0])
                steps = int(current_shape[0])
                in_channels = int(current_shape[-1]) if len(current_shape) == 2 else 1
                conv_params = (kernel * in_channels + 1) * filters
                total_params += conv_params
                trainable_params += conv_params
                # El worker usa padding="same": la longitud de la secuencia no cambia.
                current_shape = [steps, filters]

            elif l_type == "MaxPooling1D":
                if len(current_shape) not in {1, 2}:
                    errors.append(
                        f"Capa {idx} (MaxPooling1D): requiere [features] o [steps, channels]. "
                        f"Actual: {current_shape}."
                    )
                    continue
                raw_pool = layer.pool_size or [2]
                if not isinstance(raw_pool, list):
                    raw_pool = [raw_pool]
                if len(raw_pool) != 1 or int(raw_pool[0]) <= 0:
                    errors.append(f"Capa {idx} (MaxPooling1D): pool_size inválido.")
                    continue
                channels = int(current_shape[-1]) if len(current_shape) == 2 else 1
                current_shape = [int(current_shape[0]), channels]

            elif l_type == "Conv2D":
                if len(current_shape) != 3:
                    errors.append(
                        f"Capa {idx} (Conv2D): requiere tensor [H, W, C]. Actual: {current_shape}."
                    )
                    continue
                filters = layer.filters or 32
                k_size = layer.kernel_size or [3, 3]
                if len(k_size) != 2 or any(k <= 0 for k in k_size):
                    errors.append(f"Capa {idx} (Conv2D): kernel_size inválido.")
                    continue
                in_channels = current_shape[2]
                conv_params = (k_size[0] * k_size[1] * in_channels + 1) * filters
                total_params += conv_params
                trainable_params += conv_params
                current_shape = [
                    current_shape[0] - k_size[0] + 1,
                    current_shape[1] - k_size[1] + 1,
                    filters,
                ]
                if current_shape[0] < 1 or current_shape[1] < 1:
                    errors.append(
                        f"Capa {idx} (Conv2D): el kernel {k_size} es mayor que la entrada; "
                        "la salida quedaría vacía."
                    )
                    current_shape = [1, 1, filters]

            elif l_type == "MaxPooling2D":
                if len(current_shape) != 3:
                    errors.append(f"Capa {idx} (MaxPooling2D): requiere un tensor [H, W, C].")
                    continue
                p_size = layer.pool_size or [2, 2]
                if len(p_size) != 2 or any(p <= 0 for p in p_size):
                    errors.append(f"Capa {idx} (MaxPooling2D): pool_size inválido.")
                    continue
                current_shape = [
                    max(1, current_shape[0] // p_size[0]),
                    max(1, current_shape[1] // p_size[1]),
                    current_shape[2],
                ]

            elif l_type == "Flatten":
                prod = 1
                for dim in current_shape:
                    prod *= int(dim)
                current_shape = [prod]

            elif l_type in {"LSTM", "GRU", "SimpleRNN"}:
                units = layer.units or 64
                if units <= 0:
                    errors.append(f"Capa {idx} ({l_type}): units debe ser > 0.")
                    continue
                in_dim = current_shape[-1]
                factor = {"LSTM": 4, "GRU": 3, "SimpleRNN": 1}[l_type]
                rec_params = factor * ((in_dim + units) * units + units)
                total_params += rec_params
                trainable_params += rec_params
                if layer.return_sequences:
                    current_shape = [current_shape[0], units]
                else:
                    current_shape = [units]

            elif l_type == "BatchNormalization":
                if len(current_shape) != 1:
                    errors.append(
                        f"Capa {idx} (BatchNormalization): requiere entrada 2D; actual {current_shape}."
                    )
                    continue
                num_features = current_shape[-1]
                total_params += num_features * 4
                trainable_params += num_features * 2

        # La última capa debe producir la salida del modelo.
        if topology.layers:
            last = topology.layers[-1]
            if last.type.strip() != "Dense":
                errors.append(
                    "La última capa debe ser Dense para definir la salida del modelo "
                    "(clasificación o regresión)."
                )
            elif last.type.strip() in FAMILY_LAYERS[family] and last.units:
                expected_activation = (last.activation or "").lower()
                if family in {"FEEDFORWARD", "CNN", "RNN"}:
                    if expected_activation in {"sigmoid", "softmax", "linear"}:
                        pass  # válido; la compatibilidad exacta se comprueba contra el dataset
                    else:
                        warnings.append(
                            "La capa de salida debería usar sigmoid/softmax (clasificación) "
                            "o linear (regresión)."
                        )
        if family == "RNN" and not any(
            layer.type.strip() in {"LSTM", "GRU", "SimpleRNN"} for layer in topology.layers
        ):
            errors.append("La familia RNN requiere al menos una capa LSTM, GRU o SimpleRNN.")
        if family == "CNN" and not any(
            layer.type.strip() in {"Conv1D", "Conv2D", "MaxPooling1D", "MaxPooling2D"} for layer in topology.layers
        ):
            errors.append("La familia CNN requiere al menos una capa convolucional (Conv1D/Conv2D) o de pooling.")

        is_valid = len(errors) == 0
        trainable = is_valid
        trainable_reason: Optional[str] = None
        if family == "GAN":
            trainable = False
            trainable_reason = (
                "GAN es una arquitectura generativa no supervisada (diseño conceptual disponible en el catálogo). "
                "Para problemas supervisados de clasificación o regresión con target, utilice FEEDFORWARD, RNN o CNN."
            )
        elif family in {"FEEDFORWARD", "RNN", "CNN"}:
            trainable = is_valid
            trainable_reason = None

        return ArchitectureValidationResult(
            valid=is_valid,
            total_parameters=total_params,
            trainable_parameters=trainable_params,
            output_shape=[None] + current_shape,
            warnings=warnings,
            errors=errors,
            trainable=trainable,
            trainable_reason=trainable_reason,
        )
