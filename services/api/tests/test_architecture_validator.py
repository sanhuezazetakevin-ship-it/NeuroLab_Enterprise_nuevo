from app.modules.architectures.validator import ArchitectureValidator
from app.schemas.architecture import NetworkTopology, LayerConfig

def test_feedforward_valid_architecture():
    topology = NetworkTopology(
        input_shape=[10],
        layers=[
            LayerConfig(type="Dense", units=32, activation="relu"),
            LayerConfig(type="Dropout", rate=0.2),
            LayerConfig(type="Dense", units=1, activation="sigmoid")
        ]
    )
    result = ArchitectureValidator.validate_topology(topology, "FEEDFORWARD")
    assert result.valid is True
    assert result.total_parameters > 0
    assert result.output_shape == [None, 1]
    assert len(result.errors) == 0

def test_feedforward_invalid_layer_units():
    topology = NetworkTopology(
        input_shape=[10],
        layers=[
            LayerConfig(type="Dense", activation="relu")
        ]
    )
    result = ArchitectureValidator.validate_topology(topology, "FEEDFORWARD")
    assert result.valid is False
    assert len(result.errors) >= 1
    assert "Dense" in result.errors[0]

def test_cnn_valid_architecture():
    topology = NetworkTopology(
        input_shape=[28],
        layers=[
            LayerConfig(type="Conv1D", filters=32, kernel_size=[3], activation="relu"),
            LayerConfig(type="MaxPooling1D", pool_size=[2]),
            LayerConfig(type="Flatten"),
            LayerConfig(type="Dense", units=10, activation="softmax")
        ]
    )
    result = ArchitectureValidator.validate_topology(topology, "CNN")
    assert result.valid is True
    assert result.output_shape == [None, 10]


def test_cnn_rejects_2d_layers_for_tabular_data():
    topology = NetworkTopology(
        input_shape=[28, 28, 1],
        layers=[
            LayerConfig(type="Conv2D", filters=32, kernel_size=[3, 3], activation="relu"),
            LayerConfig(type="MaxPooling2D", pool_size=[2, 2]),
            LayerConfig(type="Flatten"),
            LayerConfig(type="Dense", units=10, activation="softmax")
        ]
    )
    result = ArchitectureValidator.validate_topology(topology, "CNN")
    assert result.valid is False
    assert result.trainable is False
    assert any("Conv2D" in error for error in result.errors)


def test_rnn_accepts_simple_rnn():
    topology = NetworkTopology(
        input_shape=[10],
        layers=[
            LayerConfig(type="SimpleRNN", units=8, return_sequences=False),
            LayerConfig(type="Dense", units=1, activation="sigmoid")
        ]
    )
    result = ArchitectureValidator.validate_topology(topology, "RNN")
    assert result.valid is True
    assert result.total_parameters > 0
    assert result.output_shape == [None, 1]
