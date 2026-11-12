import React, { useState } from 'react';
import {
  BookOpen,
  Sliders,
  RotateCcw,
  Network,
  HelpCircle,
  Check,
  Info,
  Maximize2,
  TrendingUp,
  Layers
} from 'lucide-react';
import { useApp } from '../../lib/AppContext';
import { EnlargedChartModal } from '../../components/common/EnlargedChartModal';

export const FundamentalsView: React.FC = () => {
  const { showToast } = useApp();

  // Interactive artificial neuron state
  const [x1, setX1] = useState(0.8);
  const [x2, setX2] = useState(-0.5);
  const [w1, setW1] = useState(1.4);
  const [w2, setW2] = useState(0.8);
  const [bias, setBias] = useState(-0.2);
  const [activationFn, setActivationFn] = useState<'relu' | 'sigmoid' | 'tanh' | 'leaky_relu'>('relu');

  // Math calculation: z = x1*w1 + x2*w2 + bias
  const z = Number((x1 * w1 + x2 * w2 + bias).toFixed(3));

  // Compute activation
  let activated = 0;
  if (activationFn === 'relu') {
    activated = Math.max(0, z);
  } else if (activationFn === 'sigmoid') {
    activated = 1 / (1 + Math.exp(-z));
  } else if (activationFn === 'tanh') {
    activated = Math.tanh(z);
  } else if (activationFn === 'leaky_relu') {
    activated = z > 0 ? z : 0.1 * z;
  }
  const y = Number(activated.toFixed(3));

  // Compute derivative f'(z)
  let gradVal = 0;
  if (activationFn === 'relu') {
    gradVal = z > 0 ? 1 : 0;
  } else if (activationFn === 'sigmoid') {
    const s = 1 / (1 + Math.exp(-z));
    gradVal = s * (1 - s);
  } else if (activationFn === 'tanh') {
    const t = Math.tanh(z);
    gradVal = 1 - t * t;
  } else if (activationFn === 'leaky_relu') {
    gradVal = z > 0 ? 1 : 0.1;
  }
  const grad = Number(gradVal.toFixed(3));

  // Modal enlargement state
  const [enlargedModal, setEnlargedModal] = useState<'neuron' | 'activation' | 'boundary' | 'gradient' | 'contribution' | 'loss' | null>(null);

  const resetNeuron = () => {
    setX1(0.8);
    setX2(-0.5);
    setW1(1.4);
    setW2(0.8);
    setBias(-0.2);
    setActivationFn('relu');
    showToast('Parámetros de neurona restablecidos', 'info');
  };

  // Render SVG Activation Curve in Frosted Grey Style
  const renderActivationCurve = (isLarge = false) => {
    const points: string[] = [];
    const minZ = -4;
    const maxZ = 4;
    const width = isLarge ? 640 : 180;
    const height = isLarge ? 240 : 115;
    const padding = isLarge ? 30 : 10;

    for (let currentZ = minZ; currentZ <= maxZ; currentZ += 0.2) {
      let val = 0;
      if (activationFn === 'relu') val = Math.max(0, currentZ);
      else if (activationFn === 'sigmoid') val = 1 / (1 + Math.exp(-currentZ));
      else if (activationFn === 'tanh') val = Math.tanh(currentZ);
      else if (activationFn === 'leaky_relu') val = currentZ > 0 ? currentZ : 0.1 * currentZ;

      const px = padding + ((currentZ - minZ) / (maxZ - minZ)) * (width - 2 * padding);
      let py = height / 2;
      if (activationFn === 'sigmoid') {
        py = (height - padding) - val * (height - 2 * padding);
      } else if (activationFn === 'tanh') {
        py = (height / 2) - val * ((height - 2 * padding) / 2);
      } else {
        py = (height - padding) - (val / 4) * (height - 2 * padding);
      }
      points.push(`${px.toFixed(1)},${py.toFixed(1)}`);
    }

    const clampedZ = Math.max(-4, Math.min(4, z));
    const dotX = padding + ((clampedZ - minZ) / (maxZ - minZ)) * (width - 2 * padding);
    let dotY = height / 2;
    if (activationFn === 'sigmoid') {
      dotY = (height - padding) - y * (height - 2 * padding);
    } else if (activationFn === 'tanh') {
      dotY = (height / 2) - y * ((height - 2 * padding) / 2);
    } else {
      dotY = (height - padding) - (Math.min(4, y) / 4) * (height - 2 * padding);
    }

    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible select-none text-zinc-900 dark:text-white">
        <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} stroke="currentColor" strokeOpacity="0.15" strokeDasharray="3 3" />
        <line x1={width / 2} y1={padding} x2={width / 2} y2={height - padding} stroke="currentColor" strokeOpacity="0.15" strokeDasharray="3 3" />

        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth={isLarge ? "2.5" : "2"}
          points={points.join(' ')}
          strokeLinecap="round"
        />

        <circle cx={dotX} cy={dotY} r={isLarge ? "5" : "3.5"} fill="currentColor" stroke="var(--canvas-bg)" strokeWidth="1.5" />
      </svg>
    );
  };


  // Render SVG 2D Decision Boundary
  const renderDecisionBoundary = (isLarge = false) => {
    const width = isLarge ? 560 : 180;
    const height = isLarge ? 300 : 115;
    const padding = isLarge ? 32 : 10;
    const clipId = isLarge ? 'clip-boundary-lg' : 'clip-boundary-sm';

    const scaleX = (width - 2 * padding) / 4.4;
    const scaleY = (height - 2 * padding) / 4.4;
    const toSvg = (px: number, py: number): [number, number] => [
      width / 2 + px * scaleX,
      height / 2 - py * scaleY,
    ];

    // Compute line endpoints: w1*x1 + w2*x2 + bias = 0 -> x2 = -(bias + w1*x1)/w2
    let xA = -3, yA = 0, xB = 3, yB = 0;
    if (Math.abs(w2) > 0.001) {
      yA = -(bias + w1 * -3) / w2;
      yB = -(bias + w1 * 3) / w2;
    } else {
      xA = -bias / (w1 || 0.001);
      xB = xA;
      yA = -3;
      yB = 3;
    }
    const [lineX1, lineY1] = toSvg(xA, yA);
    const [lineX2, lineY2] = toSvg(xB, yB);
    const [ptX, ptY] = toSvg(Math.max(-2.1, Math.min(2.1, x1)), Math.max(-2.1, Math.min(2.1, x2)));

    // Reference scatter points for Class 0 (faint blue) and Class 1 (faint rose)
    const samples = [
      { x: -1.2, y: -1.0, c: 0 },
      { x: -0.7, y: -1.4, c: 0 },
      { x: -1.4, y: -0.4, c: 0 },
      { x: -0.4, y: -1.2, c: 0 },
      { x: 1.1, y: 1.2, c: 1 },
      { x: 1.4, y: 0.6, c: 1 },
      { x: 0.8, y: 1.4, c: 1 },
      { x: 1.5, y: 1.1, c: 1 },
    ];

    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible select-none text-zinc-900 dark:text-white">
        <defs>
          <clipPath id={clipId}>
            <rect x={padding} y={padding} width={width - 2 * padding} height={height - 2 * padding} rx="4" />
          </clipPath>
        </defs>

        {/* Axes */}
        <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} stroke="currentColor" strokeOpacity="0.15" strokeDasharray="3 3" />
        <line x1={width / 2} y1={padding} x2={width / 2} y2={height - padding} stroke="currentColor" strokeOpacity="0.15" strokeDasharray="3 3" />

        <g clipPath={`url(#${clipId})`}>
          {/* Reference scatter points */}
          {samples.map((s, idx) => {
            const [sx, sy] = toSvg(s.x, s.y);
            return (
              <circle
                key={idx}
                cx={sx}
                cy={sy}
                r={isLarge ? '3.5' : '2'}
                fill={s.c === 1 ? '#f43f5e' : '#38bdf8'}
                fillOpacity={0.4}
              />
            );
          })}

          {/* Decision boundary line: w1*x1 + w2*x2 + b = 0 */}
          <line
            x1={lineX1}
            y1={lineY1}
            x2={lineX2}
            y2={lineY2}
            stroke="#fb7185"
            strokeWidth={isLarge ? '2.5' : '2'}
            strokeLinecap="round"
          />
        </g>

        {/* Current dynamic point P(x1, x2) */}
        <circle
          cx={ptX}
          cy={ptY}
          r={isLarge ? '5.5' : '3.5'}
          fill={z > 0 ? '#f43f5e' : '#64748b'}
          stroke="#ffffff"
          strokeWidth="1.5"
        />
        {isLarge && (
          <text x={ptX + 8} y={ptY - 8} fontSize="10" fill="currentColor" fontWeight="bold" fontFamily="monospace">
            P({x1}, {x2}) {z > 0 ? '→ [Clase 1]' : '→ [Clase 0]'}
          </text>
        )}
      </svg>
    );
  };

  // Render SVG Gradient / Derivative Curve f'(z)
  const renderGradientCurve = (isLarge = false) => {
    const width = isLarge ? 640 : 180;
    const height = isLarge ? 240 : 115;
    const padding = isLarge ? 30 : 10;
    const points: string[] = [];

    for (let cz = -4; cz <= 4; cz += 0.2) {
      let df = 0;
      if (activationFn === 'relu') df = cz > 0 ? 1 : 0;
      else if (activationFn === 'sigmoid') {
        const s = 1 / (1 + Math.exp(-cz));
        df = s * (1 - s);
      } else if (activationFn === 'tanh') {
        const t = Math.tanh(cz);
        df = 1 - t * t;
      } else if (activationFn === 'leaky_relu') {
        df = cz > 0 ? 1 : 0.1;
      }

      const px = padding + ((cz - (-4)) / 8) * (width - 2 * padding);
      const py = height - padding - (df / 1.15) * (height - 2 * padding);
      points.push(`${px.toFixed(1)},${py.toFixed(1)}`);
    }

    const clampedZ = Math.max(-4, Math.min(4, z));
    const dotX = padding + ((clampedZ - (-4)) / 8) * (width - 2 * padding);
    const dotY = height - padding - (Math.min(1.15, Math.max(0, gradVal)) / 1.15) * (height - 2 * padding);

    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible select-none text-zinc-900 dark:text-white">
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="currentColor" strokeOpacity="0.2" />
        <line x1={width / 2} y1={padding} x2={width / 2} y2={height - padding} stroke="currentColor" strokeOpacity="0.15" strokeDasharray="3 3" />

        {activationFn === 'sigmoid' && (
          <line
            x1={padding}
            y1={height - padding - (0.25 / 1.15) * (height - 2 * padding)}
            x2={width - padding}
            y2={height - padding - (0.25 / 1.15) * (height - 2 * padding)}
            stroke="#f59e0b"
            strokeOpacity="0.3"
            strokeDasharray="2 2"
          />
        )}

        <polyline
          fill="none"
          stroke="#38bdf8"
          strokeWidth={isLarge ? '2.5' : '2'}
          points={points.join(' ')}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        <circle
          cx={dotX}
          cy={dotY}
          r={isLarge ? '5' : '3.5'}
          fill="#38bdf8"
          stroke="#ffffff"
          strokeWidth="1.5"
        />
      </svg>
    );
  };


  // Render SVG Synaptic Contribution Bars (w1*x1, w2*x2, bias)
  const renderContributionBars = (isLarge = false) => {
    const width = isLarge ? 560 : 180;
    const height = isLarge ? 240 : 115;
    const padding = isLarge ? 24 : 8;

    const term1 = Number((w1 * x1).toFixed(2));
    const term2 = Number((w2 * x2).toFixed(2));
    const termB = Number(bias.toFixed(2));

    const maxVal = Math.max(2.5, Math.abs(term1), Math.abs(term2), Math.abs(termB));
    const midX = width / 2;
    const rowH = (height - 2 * padding) / 3;

    const renderRow = (val: number, rowIdx: number, label: string, color: string) => {
      const barW = (Math.abs(val) / maxVal) * (width / 2 - padding - 36);
      const barX = val >= 0 ? midX : midX - barW;
      const barY = padding + rowIdx * rowH + rowH * 0.18;
      const h = rowH * 0.64;
      return (
        <g key={rowIdx}>
          <text x={padding + 2} y={barY + h * 0.72} fontSize={isLarge ? "10" : "8"} fill="currentColor" opacity="0.65" fontFamily="monospace">
            {label}
          </text>
          <rect x={barX} y={barY} width={Math.max(2, barW)} height={h} rx="2" fill={color} />
          <text
            x={val >= 0 ? barX + barW + 4 : barX - 4}
            y={barY + h * 0.72}
            fontSize={isLarge ? "10" : "8"}
            textAnchor={val >= 0 ? "start" : "end"}
            fill="currentColor"
            fontWeight="bold"
            fontFamily="monospace"
          >
            {val > 0 ? `+${val}` : val}
          </text>
        </g>
      );
    };

    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible select-none text-zinc-900 dark:text-white">
        <line x1={midX} y1={padding} x2={midX} y2={height - padding} stroke="currentColor" strokeOpacity="0.2" />
        {renderRow(term1, 0, "w1·x1", term1 >= 0 ? "#f43f5e" : "#38bdf8")}
        {renderRow(term2, 1, "w2·x2", term2 >= 0 ? "#f43f5e" : "#38bdf8")}
        {renderRow(termB, 2, "sesgo", termB >= 0 ? "#fbbf24" : "#94a3b8")}
      </svg>
    );
  };

  // Render SVG Loss Surface Parabola
  const renderLossSurface = (isLarge = false) => {
    const width = isLarge ? 560 : 180;
    const height = isLarge ? 240 : 115;
    const padding = isLarge ? 24 : 10;

    const wOpt = 0.5;
    const currentLoss = Number((0.5 * Math.pow(w1 - wOpt, 2)).toFixed(3));
    const gradDirection = w1 > wOpt ? "← Descenso" : "Descenso →";

    const points: string[] = [];
    for (let w = -2; w <= 2; w += 0.2) {
      const l = 0.5 * Math.pow(w - wOpt, 2);
      const px = padding + ((w - (-2)) / 4) * (width - 2 * padding);
      const py = (height - padding) - (l / 3.2) * (height - 2 * padding);
      points.push(`${px.toFixed(1)},${py.toFixed(1)}`);
    }

    const dotX = padding + ((w1 - (-2)) / 4) * (width - 2 * padding);
    const dotY = (height - padding) - (Math.min(3.2, currentLoss) / 3.2) * (height - 2 * padding);

    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible select-none text-zinc-900 dark:text-white">
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="currentColor" strokeOpacity="0.2" />
        <polyline fill="none" stroke="#f43f5e" strokeWidth={isLarge ? "2.5" : "2"} points={points.join(' ')} strokeLinecap="round" />
        <circle cx={dotX} cy={dotY} r={isLarge ? "5.5" : "3.5"} fill="#f43f5e" stroke="#ffffff" strokeWidth="1.5" />
        {isLarge && (
          <text x={dotX + 6} y={dotY - 6} fontSize="10" fill="currentColor" fontFamily="monospace">
            L={currentLoss} ({gradDirection})
          </text>
        )}
      </svg>
    );
  };

  // Render SVG Neuron Diagram in Frosted Grey Style
  const renderNeuronSVG = (isLarge = false) => {
    const w = isLarge ? 600 : 175;
    const h = isLarge ? 240 : 115;
    const scale = isLarge ? 1.5 : 0.66;

    return (
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto overflow-visible select-none text-zinc-900 dark:text-white">
        {/* Connections */}
        <line
          x1={40 * scale}
          y1={45 * scale}
          x2={130 * scale}
          y2={85 * scale}
          stroke="currentColor"
          strokeOpacity={w1 >= 0 ? "0.9" : "0.35"}
          strokeWidth={Math.max(1.5, Math.abs(w1) * 2)}
          strokeLinecap="round"
        />
        <line
          x1={40 * scale}
          y1={125 * scale}
          x2={130 * scale}
          y2={85 * scale}
          stroke="currentColor"
          strokeOpacity={w2 >= 0 ? "0.9" : "0.35"}
          strokeWidth={Math.max(1.5, Math.abs(w2) * 2)}
          strokeLinecap="round"
        />
        <line
          x1={130 * scale}
          y1={85 * scale}
          x2={210 * scale}
          y2={85 * scale}
          stroke="currentColor"
          strokeOpacity="0.4"
          strokeWidth="1.5"
          strokeDasharray="3 3"
        />

        {/* Input 1 */}
        <circle cx={40 * scale} cy={45 * scale} r={14 * scale} fill="currentColor" fillOpacity="0.08" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
        <text x={40 * scale} y={48 * scale} fontSize={9 * scale} textAnchor="middle" fill="currentColor" fontWeight="bold">x1</text>

        {/* Input 2 */}
        <circle cx={40 * scale} cy={125 * scale} r={14 * scale} fill="currentColor" fillOpacity="0.08" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
        <text x={40 * scale} y={128 * scale} fontSize={9 * scale} textAnchor="middle" fill="currentColor" fontWeight="bold">x2</text>

        {/* Sum node */}
        <circle cx={130 * scale} cy={85 * scale} r={20 * scale} fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.5" />
        <text x={130 * scale} y={83 * scale} fontSize={9 * scale} textAnchor="middle" fill="currentColor" fontWeight="bold">&sum;+b</text>
        <text x={130 * scale} y={95 * scale} fontSize={8 * scale} textAnchor="middle" fill="currentColor" opacity="0.7" fontFamily="monospace">z={z}</text>

        {/* Activation Node */}
        <rect x={195 * scale} y={67 * scale} width={36 * scale} height={36 * scale} rx={isLarge ? 6 : 2} fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.5" />
        <text x={213 * scale} y={83 * scale} fontSize={8 * scale} textAnchor="middle" fill="currentColor" opacity="0.8" fontWeight="bold">{activationFn}</text>
        <text x={213 * scale} y={95 * scale} fontSize={9 * scale} textAnchor="middle" fill="currentColor" fontFamily="monospace" fontWeight="bold">y={y}</text>
      </svg>
    );
  };

  // Interactive Quiz state
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number | null>>({});

  const quizQuestions = [
    {
      id: 1,
      q: '¿Cuál es el rol del término de sesgo (bias b) en la combinación lineal de una neurona?',
      options: [
        'Amplificar linealmente el producto punto de las entradas.',
        'Desplazar la función de activación horizontalmente para controlar el umbral de disparo.',
        'Normalizar la suma vectorial entre cero y uno.'
      ],
      correct: 1,
      explanation: 'El sesgo permite que la neurona dispare una salida no nula incluso cuando el vector de entradas es idéntico a cero.'
    },
    {
      id: 2,
      q: '¿Por qué la función ReLU es el estándar en capas ocultas de redes neuronales profundas?',
      options: [
        'Porque restringe la salida a valores centrados en cero.',
        'Porque mitiga el desvanecimiento del gradiente al tener derivada 1 para z > 0.',
        'Porque es estrictamente convexa en todo el espacio de entrada.'
      ],
      correct: 1,
      explanation: 'La derivada constante de ReLU para entradas positivas preserva la magnitud de los gradientes durante la retropropagación (Backpropagation).'
    }
  ];

  const handleSelectQuiz = (questionId: number, optIndex: number) => {
    setQuizAnswers((prev) => ({ ...prev, [questionId]: optIndex }));
  };

  const families = [
    {
      id: 'FEEDFORWARD',
      title: 'Feedforward (MLP)',
      tag: 'Tabular',
      desc: 'Flujo unidireccional sin ciclos. Adecuada para datos tabulares y clasificación estructurada.',
    },
    {
      id: 'CNN',
      title: 'Convolucional (CNN)',
      tag: 'Visión 2D',
      desc: 'Filtros espaciales que extraen patrones locales preservando invariancia ante traslación.',
    },
    {
      id: 'RNN',
      title: 'Recurrente (LSTM)',
      tag: 'Secuencias',
      desc: 'Células de memoria que retienen contexto a lo largo de pasos de tiempo secuenciales.',
    },
    {
      id: 'GAN',
      title: 'Generativa (GAN)',
      tag: 'Adversaria',
      desc: 'Estructura dual: Generador compite frente a Discriminador en juego minimax.',
    }
  ];

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-black/10 dark:border-white/10">
        <div>
          <div className="flex items-center gap-2 text-zinc-600 dark:text-white/60 text-xs font-semibold uppercase tracking-wider">
            <BookOpen className="w-4 h-4 text-zinc-800 dark:text-white/80" /> Módulo 03 • Fundamentos Neuronales
          </div>
          <h1 className="text-xl sm:text-2xl font-semibold text-zinc-900 dark:text-white mt-1">
            Matemáticas y Estructura del Perceptrón
          </h1>
          <p className="text-xs text-zinc-600 dark:text-white/65 mt-0.5">
            Operaciones de aprendizaje: entender la neurona artificial, sinapsis, sesgos y funciones de activación no lineales.
          </p>
        </div>

        <button
          onClick={resetNeuron}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl glass-btn-secondary text-xs font-medium self-start sm:self-auto"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Restablecer Valores
        </button>
      </div>

      {/* Main Grid: Left Primary Controls (2 cols) + Right Compact Previews (1 col) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* LEFT COLUMN: Controls & Academic Quiz */}
        <div className="lg:col-span-2 space-y-4">
          {/* Sliders for Inputs, Weights and Bias */}
          <div className="glass-card p-5 rounded-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-black/10 dark:border-white/10 pb-3">
              <span className="text-xs font-semibold text-zinc-900 dark:text-white/90 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-zinc-600 dark:text-white/70" /> Parámetros Sinápticos (w) y Sesgo (b)
              </span>
              <span className="text-xs font-mono font-medium text-zinc-800 dark:text-white/80">
                y = f( &sum; w_i &middot; x_i + b ) = {y}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <div className="flex justify-between text-zinc-600 dark:text-white/60 mb-1.5">
                  <span>Entrada x1: <strong className="text-zinc-900 dark:text-white">{x1}</strong></span>
                  <span className="font-mono text-zinc-900 dark:text-white font-medium">w1: {w1}</span>
                </div>
                <input
                  type="range"
                  min="-2"
                  max="2"
                  step="0.1"
                  value={w1}
                  onChange={(e) => setW1(parseFloat(e.target.value))}
                  className="w-full accent-zinc-900 dark:accent-white cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-zinc-600 dark:text-white/60 mb-1.5">
                  <span>Entrada x2: <strong className="text-zinc-900 dark:text-white">{x2}</strong></span>
                  <span className="font-mono text-zinc-900 dark:text-white font-medium">w2: {w2}</span>
                </div>
                <input
                  type="range"
                  min="-2"
                  max="2"
                  step="0.1"
                  value={w2}
                  onChange={(e) => setW2(parseFloat(e.target.value))}
                  className="w-full accent-zinc-900 dark:accent-white cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-zinc-600 dark:text-white/60 mb-1.5">
                  <span>Sesgo (Bias b):</span>
                  <span className="font-mono font-medium text-zinc-900 dark:text-white">{bias}</span>
                </div>
                <input
                  type="range"
                  min="-2"
                  max="2"
                  step="0.1"
                  value={bias}
                  onChange={(e) => setBias(parseFloat(e.target.value))}
                  className="w-full accent-zinc-900 dark:accent-white cursor-pointer"
                />
              </div>

              <div>
                <label className="block text-zinc-600 dark:text-white/60 mb-1.5">Función de Activación f(z):</label>
                <select
                  value={activationFn}
                  onChange={(e) => setActivationFn(e.target.value as any)}
                  className="w-full glass-input rounded-xl px-3 py-1.5"
                >
                  <option value="relu">ReLU: max(0, z)</option>
                  <option value="sigmoid">Sigmoid: 1/(1+e^-z)</option>
                  <option value="tanh">Tanh: tanh(z)</option>
                  <option value="leaky_relu">Leaky ReLU: z o 0.1z</option>
                </select>
              </div>
            </div>

            <div className="pt-2 border-t border-black/5 dark:border-white/5 text-xs text-zinc-500 dark:text-white/65 flex items-center justify-between">
              <span>Combinación lineal: z = ({x1}&times;{w1}) + ({x2}&times;{w2}) + ({bias}) = <strong className="text-zinc-900 dark:text-white">{z}</strong></span>
              <span>Disparo: y = <strong className="text-zinc-900 dark:text-white">{y}</strong></span>
            </div>
          </div>

          {/* Families Catalog Grid */}
          <div className="grid grid-cols-2 gap-3">
            {families.map((fam) => (
              <div key={fam.id} className="glass-card p-4 rounded-2xl glass-card-hover space-y-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-zinc-900 dark:text-white">{fam.title}</h3>
                  <span className="text-xs px-2 py-0.5 rounded-full glass-inset text-zinc-700 dark:text-white/70 font-mono">
                    {fam.tag}
                  </span>
                </div>
                <p className="text-xs text-zinc-600 dark:text-white/65 leading-tight">{fam.desc}</p>
              </div>
            ))}
          </div>

          {/* Interactive Checkpoint Quiz */}
          <div className="glass-card p-5 rounded-2xl space-y-3">
            <span className="text-xs font-semibold text-zinc-900 dark:text-white flex items-center gap-1.5">
              <HelpCircle className="w-3.5 h-3.5 text-zinc-600 dark:text-white/70" /> Evaluación rápida de conceptos
            </span>

            {quizQuestions.map((q) => {
              const selected = quizAnswers[q.id];
              const isAnswered = selected !== undefined && selected !== null;
              const isCorrect = selected === q.correct;

              return (
                <div key={q.id} className="p-3.5 rounded-2xl glass-inset border border-black/10 dark:border-white/10 text-xs space-y-2">
                  <p className="font-medium text-zinc-900 dark:text-white">{q.id}. {q.q}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {q.options.map((opt, optIdx) => {
                      let btnStyle = 'border-black/10 dark:border-white/10 text-zinc-700 dark:text-white/70 hover:bg-black/5 dark:hover:bg-white/[0.08]';
                      if (isAnswered) {
                        if (optIdx === q.correct) btnStyle = 'border-zinc-900 dark:border-white bg-black/10 dark:bg-white/20 text-zinc-900 dark:text-white font-semibold';
                        else if (optIdx === selected) btnStyle = 'border-red-400/40 bg-red-500/10 text-red-600 dark:text-red-300';
                        else btnStyle = 'opacity-30';
                      }

                      return (
                        <button
                          key={optIdx}
                          disabled={isAnswered}
                          onClick={() => handleSelectQuiz(q.id, optIdx)}
                          className={`p-2.5 rounded-xl border text-left text-xs transition-colors ${btnStyle}`}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                  {isAnswered && (
                    <div className="text-xs text-zinc-500 dark:text-white/65 pt-1 border-t border-black/5 dark:border-white/5">
                      {q.explanation}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT DOCK: 2-Column Grid of 8 Telemetry Cards (fills empty space seamlessly) */}
        <div className="space-y-3">
          <div className="text-xs font-medium text-zinc-600 dark:text-white/65 flex items-center justify-between px-1">
            <span>Visualizaciones (Dock)</span>
            <span className="text-xs text-zinc-800 dark:text-white/70">6 Gráficos interactivos · Clic para ampliar</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {/* Card 1: Grafo Sináptico */}
            <div
              onClick={() => setEnlargedModal('neuron')}
              className="glass-card p-2.5 rounded-lg border border-black/10 dark:border-rose-500/20 glass-card-hover cursor-pointer space-y-1.5 shadow-sm"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-zinc-900 dark:text-white flex items-center gap-1">
                  <Network className="w-3 h-3 text-rose-500" /> Grafo Sináptico
                </span>
                <div className="flex items-center gap-1">
                  <span className="font-mono text-xs text-zinc-500 dark:text-white/60">z={z}</span>
                  <Maximize2 className="w-2.5 h-2.5 text-zinc-400 dark:text-white/65 hover:text-rose-400 transition-colors" />
                </div>
              </div>
              <div className="p-1 glass-inset rounded-md flex items-center justify-center">
                {renderNeuronSVG(false)}
              </div>
              <div className="flex justify-between items-center text-xs text-zinc-500 dark:text-white/65 px-0.5">
                <span>Perceptrón artificial</span>
                <span className="text-zinc-800 dark:text-rose-400 font-medium">Ampliar &rarr;</span>
              </div>
            </div>

            {/* Card 2: Curva f(z) */}
            <div
              onClick={() => setEnlargedModal('activation')}
              className="glass-card p-2.5 rounded-lg border border-black/10 dark:border-rose-500/20 glass-card-hover cursor-pointer space-y-1.5 shadow-sm"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-zinc-900 dark:text-white flex items-center gap-1">
                  <TrendingUp className="w-3 h-3 text-rose-500" /> Curva f(z): {activationFn}
                </span>
                <div className="flex items-center gap-1">
                  <span className="font-mono text-xs text-zinc-500 dark:text-white/60">y={y}</span>
                  <Maximize2 className="w-2.5 h-2.5 text-zinc-400 dark:text-white/65 hover:text-rose-400 transition-colors" />
                </div>
              </div>
              <div className="p-1 glass-inset rounded-md flex items-center justify-center">
                {renderActivationCurve(false)}
              </div>
              <div className="flex justify-between items-center text-xs text-zinc-500 dark:text-white/65 px-0.5">
                <span>Plano cartesiano [-4, 4]</span>
                <span className="text-zinc-800 dark:text-rose-400 font-medium">Ampliar &rarr;</span>
              </div>
            </div>

            {/* Card 3: Frontera 2D */}
            <div
              onClick={() => setEnlargedModal('boundary')}
              className="glass-card p-2.5 rounded-lg border border-black/10 dark:border-rose-500/20 glass-card-hover cursor-pointer space-y-1.5 shadow-sm"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-zinc-900 dark:text-white flex items-center gap-1">
                  <Sliders className="w-3 h-3 text-rose-500" /> Frontera 2D
                </span>
                <div className="flex items-center gap-1">
                  <span className={`font-mono text-xs font-semibold ${z > 0 ? 'text-rose-400' : 'text-sky-400'}`}>
                    {z > 0 ? 'Clase 1' : 'Clase 0'}
                  </span>
                  <Maximize2 className="w-2.5 h-2.5 text-zinc-400 dark:text-white/65 hover:text-rose-400 transition-colors" />
                </div>
              </div>
              <div className="p-1 glass-inset rounded-md flex items-center justify-center">
                {renderDecisionBoundary(false)}
              </div>
              <div className="flex justify-between items-center text-xs text-zinc-500 dark:text-white/65 px-0.5">
                <span>w1·x1 + w2·x2 + b = 0</span>
                <span className="text-zinc-800 dark:text-rose-400 font-medium">Ampliar &rarr;</span>
              </div>
            </div>

            {/* Card 4: Gradiente f'(z) */}
            <div
              onClick={() => setEnlargedModal('gradient')}
              className="glass-card p-2.5 rounded-lg border border-black/10 dark:border-rose-500/20 glass-card-hover cursor-pointer space-y-1.5 shadow-sm"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-zinc-900 dark:text-white flex items-center gap-1">
                  <BookOpen className="w-3 h-3 text-sky-400" /> Gradiente f&apos;(z)
                </span>
                <div className="flex items-center gap-1">
                  <span className="font-mono text-xs text-sky-400 font-semibold">f&apos;={grad}</span>
                  <Maximize2 className="w-2.5 h-2.5 text-zinc-400 dark:text-white/65 hover:text-sky-400 transition-colors" />
                </div>
              </div>
              <div className="p-1 glass-inset rounded-md flex items-center justify-center">
                {renderGradientCurve(false)}
              </div>
              <div className="flex justify-between items-center text-xs text-zinc-500 dark:text-white/65 px-0.5">
                <span>{activationFn === 'sigmoid' ? 'Máx 0.25 (Vanishing)' : activationFn === 'relu' && z <= 0 ? "f'=0 (Dying ReLU)" : 'Retropropagación'}</span>
                <span className="text-zinc-800 dark:text-rose-400 font-medium">Ampliar &rarr;</span>
              </div>
            </div>

            {/* Card 5: Aportes Ponderados */}
            <div
              onClick={() => setEnlargedModal('contribution')}
              className="glass-card p-2.5 rounded-lg border border-black/10 dark:border-rose-500/20 glass-card-hover cursor-pointer space-y-1.5 shadow-sm"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-zinc-900 dark:text-white flex items-center gap-1">
                  <Layers className="w-3 h-3 text-amber-500" /> Aportes Sinápticos
                </span>
                <div className="flex items-center gap-1">
                  <span className="font-mono text-xs text-zinc-500 dark:text-white/60">z={z}</span>
                  <Maximize2 className="w-2.5 h-2.5 text-zinc-400 dark:text-white/65 hover:text-amber-400 transition-colors" />
                </div>
              </div>
              <div className="p-1 glass-inset rounded-md flex items-center justify-center">
                {renderContributionBars(false)}
              </div>
              <div className="flex justify-between items-center text-xs text-zinc-500 dark:text-white/65 px-0.5">
                <span>Pesos w1, w2 y sesgo b</span>
                <span className="text-zinc-800 dark:text-rose-400 font-medium">Ampliar &rarr;</span>
              </div>
            </div>

            {/* Card 6: Superficie de Pérdida */}
            <div
              onClick={() => setEnlargedModal('loss')}
              className="glass-card p-2.5 rounded-lg border border-black/10 dark:border-rose-500/20 glass-card-hover cursor-pointer space-y-1.5 shadow-sm"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-zinc-900 dark:text-white flex items-center gap-1">
                  <TrendingUp className="w-3 h-3 text-rose-500" /> Función de Coste
                </span>
                <div className="flex items-center gap-1">
                  <span className="font-mono text-xs text-zinc-500 dark:text-white/60">J(w)</span>
                  <Maximize2 className="w-2.5 h-2.5 text-zinc-400 dark:text-white/65 hover:text-rose-400 transition-colors" />
                </div>
              </div>
              <div className="p-1 glass-inset rounded-md flex items-center justify-center">
                {renderLossSurface(false)}
              </div>
              <div className="flex justify-between items-center text-xs text-zinc-500 dark:text-white/65 px-0.5">
                <span>Descenso de gradiente</span>
                <span className="text-zinc-800 dark:text-rose-400 font-medium">Ampliar &rarr;</span>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* ENLARGED MODAL */}
      <EnlargedChartModal
        isOpen={enlargedModal !== null}
        onClose={() => setEnlargedModal(null)}
        title={
          enlargedModal === 'neuron'
            ? 'Esquema Sináptico del Perceptrón (Vista Ampliada)'
            : enlargedModal === 'activation'
            ? `Función de Activación ${activationFn.toUpperCase()} (Detalle Matemático)`
            : enlargedModal === 'boundary'
            ? 'Frontera de Decisión Lineal 2D (Espacio R²)'
            : enlargedModal === 'gradient'
            ? `Curva del Gradiente f'(z) para ${activationFn.toUpperCase()} (Backpropagation)`
            : enlargedModal === 'contribution'
            ? 'Desglose Ponderado de Entradas y Sesgo (Suma z)'
            : 'Superficie de Función de Coste J(w) y Descenso de Gradiente'
        }
        subtitle={
          enlargedModal === 'neuron'
            ? 'Visualización vectorial de entradas ponderadas x_i * w_i, sesgo b y nodo de activación'
            : enlargedModal === 'activation'
            ? 'Plano cartesiano de alta definición con punto de operación (z, y) en tiempo real'
            : enlargedModal === 'boundary'
            ? 'Hiperplano separador w1·x1 + w2·x2 + b = 0 dividiendo el espacio en dos regiones de clasificación'
            : enlargedModal === 'gradient'
            ? 'Derivada local de la función de activación determinando el flujo del gradiente hacia capas anteriores'
            : enlargedModal === 'contribution'
            ? 'Contribución neta de cada peso w_i·x_i y sesgo b que conforman el potencial z'
            : 'Curva cuadrática de error mostrando la dirección de optimización hacia el mínimo global'
        }
        badge="Fundamentos neuronales"
      >
        <div className="space-y-4">
          <div className="p-6 glass-inset rounded-2xl border border-black/10 dark:border-white/10 flex justify-center">
            {enlargedModal === 'neuron' && renderNeuronSVG(true)}
            {enlargedModal === 'activation' && renderActivationCurve(true)}
            {enlargedModal === 'boundary' && renderDecisionBoundary(true)}
            {enlargedModal === 'gradient' && renderGradientCurve(true)}
            {enlargedModal === 'contribution' && renderContributionBars(true)}
            {enlargedModal === 'loss' && renderLossSurface(true)}
          </div>

          <div className="p-3.5 rounded-2xl glass-inset border border-black/10 dark:border-white/10 text-xs text-zinc-700 dark:text-white/70">
            {enlargedModal === 'boundary' ? (
              <div>
                Ecuación de la recta: <strong>{w1}·x1 + {w2}·x2 + ({bias}) = 0</strong> | Punto actual: ({x1}, {x2}) | Suma neta z = {z} ({z > 0 ? 'Clase 1 positiva' : 'Clase 0 negativa'})
              </div>
            ) : enlargedModal === 'gradient' ? (
              <div>
                Derivada en punto z={z}: <strong>f&apos;({z}) = {grad}</strong> | {activationFn === 'sigmoid' ? 'Nota: La derivada de Sigmoid nunca supera 0.25, provocando desvanecimiento del gradiente en capas profundas.' : activationFn === 'relu' ? 'Nota: ReLU preserva gradiente 1.0 para z > 0, pero se anula si z <= 0 (Dying ReLU).' : 'La derivada modula la velocidad de ajuste de los pesos durante el descenso de gradiente.'}
              </div>
            ) : enlargedModal === 'contribution' ? (
              <div>
                Desglose: w1·x1 = <strong>{(w1*x1).toFixed(2)}</strong>, w2·x2 = <strong>{(w2*x2).toFixed(2)}</strong>, sesgo b = <strong>{bias.toFixed(2)}</strong> | Total z = <strong>{z}</strong>
              </div>
            ) : enlargedModal === 'loss' ? (
              <div>
                Valor de coste cuadrático respecto al objetivo óptimo: <strong>{((w1 - 0.5)**2 / 2).toFixed(3)}</strong> | Dirección de descenso recomendada para w1: {w1 > 0.5 ? 'Reducir valor (-)' : 'Aumentar valor (+)'}
              </div>
            ) : (
              <div>
                Valores activos: Entrada x1={x1}, x2={x2} | Pesos w1={w1}, w2={w2} | Sesgo b={bias} | Suma z={z} | Salida y={y}
              </div>
            )}
          </div>
        </div>
      </EnlargedChartModal>
    </div>
  );
};
