from fastapi import APIRouter
from typing import Dict, Any

router = APIRouter(prefix="/fundamentals", tags=["Fundamentos Neuronales (Semana 11)"])

FUNDAMENTALS_DATA: Dict[str, Any] = {
    "module": "Semana 11: Define la estructura y crea una red neuronal artificial",
    "concepts": [
        {
            "id": "neuron_model",
            "title": "La Neurona Artificial (Perceptrón)",
            "summary": "Unidad básica de cómputo inspirada en la neurona biológica. Recibe entradas ponderadas por pesos, suma un sesgo y aplica una función de activación.",
            "formula": "y = f( \\sum_{i=1}^{n} w_i \\cdot x_i + b )",
            "components": [
                {"name": "Entradas (x_i)", "description": "Variables o características del conjunto de datos."},
                {"name": "Pesos Sinápticos (w_i)", "description": "Fuerza y orientación de la conexión. Se ajustan durante el entrenamiento mediante Backpropagation."},
                {"name": "Sesgo / Bias (b)", "description": "Permite desplazar la función de activación horizontalmente para ajustar el umbral de disparo."},
                {"name": "Función de Activación (f)", "description": "Introduce no linealidad, permitiendo a la red aprender fronteras complejas de decisión."}
            ]
        },
        {
            "id": "activation_functions",
            "title": "Funciones de Activación Principales",
            "summary": "Mapean el valor de combinación lineal a un rango específico y determinan el gradiente para la optimización.",
            "functions": [
                {
                    "name": "ReLU (Rectified Linear Unit)",
                    "formula": "f(z) = \\max(0, z)",
                    "range": "[0, \\infty)",
                    "best_for": "Capas ocultas en Feedforward y CNN por mitigar el desvanecimiento del gradiente.",
                    "properties": "Computacionalmente eficiente, derivada constante 1 para z > 0."
                },
                {
                    "name": "Sigmoid (Logística)",
                    "formula": "\\sigma(z) = \\frac{1}{1 + e^{-z}}",
                    "range": "(0, 1)",
                    "best_for": "Capa de salida en clasificación binaria o estimación de probabilidades.",
                    "properties": "Suave, pero susceptible a desvanecimiento del gradiente en capas profundas."
                },
                {
                    "name": "Softmax",
                    "formula": "Softmax(z_i) = \\frac{e^{z_i}}{\\sum_j e^{z_j}}",
                    "range": "(0, 1), \\sum = 1",
                    "best_for": "Capa de salida en clasificación multiclase mutuamente excluyente.",
                    "properties": "Distribución de probabilidad normalizada sobre todas las clases."
                },
                {
                    "name": "Tanh (Tangente Hiperbólica)",
                    "formula": "\\tanh(z) = \\frac{e^z - e^{-z}}{e^z + e^{-z}}",
                    "range": "(-1, 1)",
                    "best_for": "Capas ocultas donde se prefieren salidas centradas en cero.",
                    "properties": "Centrada en cero, derivada más pronunciada que Sigmoid."
                }
            ]
        }
    ],
    "families": [
        {
            "family": "FEEDFORWARD",
            "name": "Redes Neuronales Feedforward (FNN / MLP)",
            "description": "La información fluye estrictamente hacia adelante desde las entradas hacia las salidas sin ciclos ni bucles de retroalimentación.",
            "use_cases": ["Clasificación tabular", "Regresión numérica", "Aprobación de créditos", "Detección de fraude"],
            "standard_layers": ["Dense", "Dropout", "BatchNormalization"]
        },
        {
            "family": "RNN",
            "name": "Redes Neuronales Recurrentes (RNN, LSTM, GRU)",
            "description": "Poseen conexiones recurrentes que forman bucles, manteniendo un estado de memoria temporal para secuencias.",
            "use_cases": ["Series de tiempo", "Procesamiento de Lenguaje Natural (NLP)", "Predicción bursátil"],
            "standard_layers": ["SimpleRNN", "LSTM", "GRU", "Dense"]
        },
        {
            "family": "CNN",
            "name": "Redes Neuronales Convolucionales (CNN)",
            "description": "Utilizan operaciones de convolución con filtros espaciales que extraen características invariantes a traslación.",
            "use_cases": ["Visión artificial", "Diagnóstico por imágenes médicas", "Clasificación de audio / espectrogramas"],
            "standard_layers": ["Conv2D", "MaxPooling2D", "Flatten", "Dense"]
        },
        {
            "family": "GAN",
            "name": "Redes Generativas Adversarias (GAN)",
            "description": "Dos redes compiten en un juego minimax de suma cero: un Generador crea datos sintéticos y un Discriminador los distingue de reales.",
            "use_cases": ["Generación de imágenes sintéticas", "Data augmentation", "Super-resolución"],
            "standard_layers": ["Generator Subnetwork", "Discriminator Subnetwork"]
        }
    ]
}

@router.get("", response_model=Dict[str, Any])
async def get_fundamentals():
    return FUNDAMENTALS_DATA
