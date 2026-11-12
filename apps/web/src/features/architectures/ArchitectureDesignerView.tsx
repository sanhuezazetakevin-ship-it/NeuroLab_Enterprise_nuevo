import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Cpu,
  Trash2,
  AlertTriangle,
  Save,
  Layers,
  ArrowRight,
  Workflow,
  Maximize2,
  MoveUp,
  MoveDown,
  RefreshCw,
  Plus,
  CheckCircle2,
  ShieldAlert,
  Info,
  FolderGit2,
  Database,
  Lock,
  Upload,
} from 'lucide-react';
import {
  ActivationFunction,
  Architecture,
  ArchitectureValidationResult,
  Dataset,
  LayerConfig,
  LayerType,
  NetworkFamily,
  NetworkTopology,
} from '../../types';
import { ApiClient } from '../../lib/api';
import { useApp } from '../../lib/AppContext';
import { EnlargedChartModal } from '../../components/common/EnlargedChartModal';
import {
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  ProjectRequiredPage,
} from '../../components/common/ProjectGuard';
import { formatDate } from '../../lib/format';
import type { GuidedTarget, NavigateFn } from '../../lib/guidedFlow';

const WRITE_ROLES = ['ADMIN', 'PROJECT_LEAD', 'AI_ENGINEER'];
const ACTIVATIONS: ActivationFunction[] = [
  'relu',
  'sigmoid',
  'tanh',
  'softmax',
  'linear',
  'elu',
  'swish',
];

const FAMILY_LABELS: Record<NetworkFamily, string> = {
  FEEDFORWARD: 'Feedforward (FNN)',
  CNN: 'Convolucional (CNN)',
  RNN: 'Recurrente (RNN / LSTM)',
  GAN: 'Generativa (GAN)',
};

const FAMILY_SHAPE: Record<NetworkFamily, number[]> = {
  FEEDFORWARD: [30],
  RNN: [30],
  CNN: [30],
  GAN: [100],
};

const SHAPE_LABELS: Record<NetworkFamily, string[]> = {
  FEEDFORWARD: ['Características'],
  RNN: ['Características'],
  CNN: ['Características'],
  GAN: ['Vector latente'],
};

const FAMILY_PALETTE: Record<NetworkFamily, LayerType[]> = {
  FEEDFORWARD: ['Dense', 'Dropout', 'BatchNormalization'],
  RNN: ['LSTM', 'GRU', 'SimpleRNN', 'Dense', 'Dropout', 'BatchNormalization'],
  CNN: ['Conv1D', 'MaxPooling1D', 'Flatten', 'Dense', 'Dropout', 'BatchNormalization'],
  GAN: ['Dense', 'Dropout', 'BatchNormalization', 'Conv2D', 'MaxPooling2D', 'Flatten'],
};

const PRESETS: Record<
  NetworkFamily,
  { name: string; inputShape: number[]; layers: LayerConfig[] }
> = {
  FEEDFORWARD: {
    name: 'MLP Feedforward',
    inputShape: [30],
    layers: [
      { type: 'Dense', units: 64, activation: 'relu' },
      { type: 'Dropout', rate: 0.2 },
      { type: 'Dense', units: 32, activation: 'relu' },
      { type: 'Dense', units: 1, activation: 'sigmoid' },
    ],
  },
  RNN: {
    name: 'LSTM Secuencial',
    inputShape: [30],
    layers: [
      { type: 'LSTM', units: 64, returnSequences: false },
      { type: 'Dropout', rate: 0.2 },
      { type: 'Dense', units: 32, activation: 'relu' },
      { type: 'Dense', units: 1, activation: 'linear' },
    ],
  },
  CNN: {
    name: 'CNN Convolucional 1D',
    inputShape: [30],
    layers: [
      { type: 'Conv1D', filters: 32, kernelSize: [3], activation: 'relu' },
      { type: 'MaxPooling1D', poolSize: [2] },
      { type: 'Conv1D', filters: 64, kernelSize: [3], activation: 'relu' },
      { type: 'MaxPooling1D', poolSize: [2] },
      { type: 'Flatten' },
      { type: 'Dense', units: 64, activation: 'relu' },
      { type: 'Dense', units: 1, activation: 'sigmoid' },
    ],
  },
  GAN: {
    name: 'Generador GAN',
    inputShape: [100],
    layers: [
      { type: 'Dense', units: 128, activation: 'relu' },
      { type: 'BatchNormalization' },
      { type: 'Dense', units: 256, activation: 'relu' },
      { type: 'BatchNormalization' },
      { type: 'Dense', units: 784, activation: 'tanh' },
    ],
  },
};

let layerSequence = 0;
const nextLayerId = () => {
  layerSequence += 1;
  return `layer-${Date.now().toString(36)}-${layerSequence}`;
};

function withIds(layers: LayerConfig[]): LayerConfig[] {
  return layers.map((layer) => ({ ...layer, id: layer.id || nextLayerId() }));
}

function defaultLayer(type: LayerType): LayerConfig {
  const base: LayerConfig = { id: nextLayerId(), type };
  if (type === 'Dense') return { ...base, units: 32, activation: 'relu' };
  if (type === 'Dropout') return { ...base, rate: 0.2 };
  if (type === 'Conv1D') return { ...base, filters: 32, kernelSize: [3], activation: 'relu' };
  if (type === 'Conv2D') return { ...base, filters: 32, kernelSize: [3, 3], activation: 'relu' };
  if (type === 'MaxPooling1D') return { ...base, poolSize: [2] };
  if (type === 'MaxPooling2D') return { ...base, poolSize: [2, 2] };
  if (type === 'LSTM' || type === 'GRU' || type === 'SimpleRNN')
    return { ...base, units: 64, returnSequences: false };
  return base;
}

// RNN y CNN se entrenan con el adaptador tabular del worker; GAN es conceptual.
const FAMILY_TRAINABLE: Record<NetworkFamily, boolean> = {
  FEEDFORWARD: true,
  RNN: true,
  CNN: true,
  GAN: false,
};

/**
 * Fija la capa de salida para que coincida con el dataset: la última capa debe
 * ser Dense con las neuronas y activación que exige la tarea.
 */
function lockOutputLayer(
  layers: LayerConfig[],
  units: number,
  activation: ActivationFunction,
): LayerConfig[] {
  if (layers.length === 0) {
    return [{ id: nextLayerId(), type: 'Dense', units, activation }];
  }
  const last = layers[layers.length - 1];
  if (last.type === 'Dense') {
    return [...layers.slice(0, -1), { ...last, units, activation }];
  }
  return [...layers, { id: nextLayerId(), type: 'Dense', units, activation }];
}

interface ArchitectureDesignerViewProps {
  onNavigate?: NavigateFn;
  guided?: GuidedTarget | null;
  onGuidedConsumed?: (id: number) => void;
}

export const ArchitectureDesignerView: React.FC<ArchitectureDesignerViewProps> = ({
  onNavigate,
  guided,
  onGuidedConsumed,
}) => {
  const { activeProject, currentRole, showToast } = useApp();
  const projectId = activeProject?.id;
  const canWrite = WRITE_ROLES.includes(currentRole);

  const [archName, setArchName] = useState('Nueva arquitectura');
  const [family, setFamily] = useState<NetworkFamily>('FEEDFORWARD');
  const [inputShape, setInputShape] = useState<number[]>(FAMILY_SHAPE.FEEDFORWARD);
  const [layers, setLayers] = useState<LayerConfig[]>(withIds(PRESETS.FEEDFORWARD.layers));

  const [validation, setValidation] = useState<ArchitectureValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [saved, setSaved] = useState<Architecture[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [enlargedTopologyOpen, setEnlargedTopologyOpen] = useState(false);

  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [datasetsLoading, setDatasetsLoading] = useState(false);
  const [datasetsError, setDatasetsError] = useState<string | null>(null);
  const [datasetId, setDatasetId] = useState<string>('');

  const selectedDataset = useMemo(
    () => datasets.find((dataset) => dataset.id === datasetId),
    [datasets, datasetId],
  );
  const neuronSummary = selectedDataset?.metadata.neurons;
  const datasetReady = Boolean(neuronSummary?.available);
  const outputLocked = datasetReady && family === 'FEEDFORWARD';
  const lockedOutputId = outputLocked ? layers[layers.length - 1]?.id : undefined;
  const hiddenLayers = datasetReady ? layers.slice(0, -1) : layers;
  const hiddenUnits = hiddenLayers
    .filter((layer) => layer.type === 'Dense' || layer.type === 'LSTM' || layer.type === 'GRU')
    .reduce((total, layer) => total + (layer.units ?? 0), 0);

  const topology = useMemo<NetworkTopology>(
    () => ({ inputShape, layers }),
    [inputShape, layers],
  );
  const topologyKey = JSON.stringify(topology);
  const validationKey = `${projectId}|${family}|${topologyKey}`;

  const loadSaved = useCallback(async () => {
    if (!projectId) return;
    setSavedLoading(true);
    try {
      const list = await ApiClient.listArchitectures(projectId);
      setSaved(list);
      setSavedError(null);
    } catch (error) {
      setSavedError(error instanceof Error ? error.message : 'No fue posible cargar arquitecturas');
    } finally {
      setSavedLoading(false);
    }
  }, [projectId]);

  const loadDatasets = useCallback(async () => {
    if (!projectId) return;
    setDatasetsLoading(true);
    try {
      const list = await ApiClient.listDatasets(projectId);
      setDatasets(list);
      setDatasetsError(null);
      setDatasetId((current) =>
        current && list.some((dataset) => dataset.id === current)
          ? current
          : list[0]?.id || '',
      );
    } catch (error) {
      setDatasetsError(
        error instanceof Error ? error.message : 'No fue posible cargar los datasets',
      );
    } finally {
      setDatasetsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId) void loadSaved();
  }, [projectId, loadSaved]);

  useEffect(() => {
    if (projectId) void loadDatasets();
  }, [projectId, loadDatasets]);

  // Flujo guiado: deja seleccionado el CSV recién subido.
  useEffect(() => {
    if (!guided?.datasetId) return;
    if (datasets.length === 0) return;
    if (datasets.some((dataset) => dataset.id === guided.datasetId)) {
      setDatasetId(guided.datasetId);
    }
    onGuidedConsumed?.(guided.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guided?.id, datasets]);

  // El tipo de red elegido al crear el proyecto es el valor inicial del editor.
  const projectFamily: NetworkFamily =
    activeProject?.networkFamily && activeProject.networkFamily in PRESETS
      ? activeProject.networkFamily
      : 'FEEDFORWARD';
  useEffect(() => {
    if (!projectId) return;
    setFamily(projectFamily);
    setArchName(PRESETS[projectFamily].name);
    setInputShape([...FAMILY_SHAPE[projectFamily]]);
    setLayers(withIds(PRESETS[projectFamily].layers.map((layer) => ({ ...layer }))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, projectFamily]);

  // Con dataset y familia Feedforward, entrada y salida las fija el CSV.
  useEffect(() => {
    if (!neuronSummary?.available || family !== 'FEEDFORWARD') return;
    const activation = (neuronSummary.outputActivation || 'linear') as ActivationFunction;
    setInputShape([neuronSummary.inputNeurons]);
    setLayers((current) =>
      lockOutputLayer(current, neuronSummary.outputNeurons, activation),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDataset?.id, neuronSummary?.available, family]);

  // Validación real en servidor (con debounce para no saturar la API).
  useEffect(() => {
    if (!projectId) {
      setValidation(null);
      return;
    }
    let active = true;
    setValidating(true);
    const timeout = window.setTimeout(() => {
      ApiClient.validateArchitecture(projectId, JSON.parse(topologyKey) as NetworkTopology, family)
        .then((result) => {
          if (!active) return;
          setValidation(result);
          setValidationError(null);
        })
        .catch((error) => {
          if (!active) return;
          setValidation(null);
          setValidationError(
            error instanceof Error ? error.message : 'No fue posible validar la arquitectura',
          );
        })
        .finally(() => {
          if (active) setValidating(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validationKey]);

  const applyPreset = (target: NetworkFamily) => {
    const preset = PRESETS[target];
    setFamily(target);
    setArchName(preset.name);
    if (target === 'FEEDFORWARD' && neuronSummary?.available) {
      const activation = (neuronSummary.outputActivation || 'linear') as ActivationFunction;
      setInputShape([neuronSummary.inputNeurons]);
      setLayers(
        withIds(
          lockOutputLayer(
            preset.layers.map((layer) => ({ ...layer })),
            neuronSummary.outputNeurons,
            activation,
          ),
        ),
      );
    } else {
      setInputShape([...preset.inputShape]);
      setLayers(withIds(preset.layers.map((layer) => ({ ...layer }))));
    }
    showToast(`Plantilla ${FAMILY_LABELS[target]} cargada`, 'info');
  };

  const handleFamilyChange = (next: NetworkFamily) => {
    if (next === family) return;
    applyPreset(next);
  };

  const updateShapeDim = (index: number, value: number) => {
    setInputShape((current) =>
      current.map((dim, idx) => (idx === index ? Math.max(1, Math.floor(value) || 1) : dim)),
    );
  };

  const addLayer = (type: LayerType) => {
    setLayers((current) => {
      const layer = defaultLayer(type);
      // La capa de salida no se mueve: las nuevas capas se insertan antes.
      if (outputLocked && current.length > 0) {
        return [...current.slice(0, -1), layer, current[current.length - 1]];
      }
      return [...current, layer];
    });
  };

  const removeLayer = (id?: string) => {
    if (outputLocked && id === lockedOutputId) {
      showToast('La capa de salida la define el conjunto de datos y no se puede eliminar', 'warning');
      return;
    }
    setLayers((current) => current.filter((layer) => layer.id !== id));
  };

  const moveLayer = (index: number, direction: 'up' | 'down') => {
    if (outputLocked && index === layers.length - 1) {
      showToast('La capa de salida debe quedar al final', 'warning');
      return;
    }
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= layers.length) return;
    if (outputLocked && targetIndex === layers.length - 1) return;
    setLayers((current) => {
      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  };

  const patchLayer = (id: string | undefined, patch: Partial<LayerConfig>) => {
    setLayers((current) =>
      current.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)),
    );
  };

  const handleSave = async () => {
    if (!projectId || !validation?.valid) return;
    if (archName.trim().length < 3) {
      showToast('El nombre debe tener al menos 3 caracteres', 'warning');
      return;
    }
    setSaving(true);
    try {
      const created = await ApiClient.createArchitecture(
        projectId,
        archName.trim(),
        family,
        topology,
      );
      showToast(`Arquitectura "${created.name}" guardada (v${created.version})`, 'success');
      await loadSaved();
      onNavigate?.('training', {
        architectureId: created.id,
        datasetId: datasetId || undefined,
      });
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'No fue posible guardar la arquitectura',
        'error',
      );
    } finally {
      setSaving(false);
    }
  };

  const loadArchitecture = (architecture: Architecture) => {
    setArchName(architecture.name);
    setFamily(architecture.family);
    const baseLayers = withIds(architecture.config.layers.map((layer) => ({ ...layer })));
    if (architecture.family === 'FEEDFORWARD' && neuronSummary?.available) {
      const activation = (neuronSummary.outputActivation || 'linear') as ActivationFunction;
      setInputShape([neuronSummary.inputNeurons]);
      setLayers(lockOutputLayer(baseLayers, neuronSummary.outputNeurons, activation));
    } else {
      setInputShape(
        architecture.config.inputShape.length
          ? [...architecture.config.inputShape]
          : [...FAMILY_SHAPE[architecture.family]],
      );
      setLayers(baseLayers);
    }
    showToast(`Arquitectura "${architecture.name}" cargada en el editor`, 'info');
  };

  const renderTopologyFlow = () => (
    <div className="flex items-center gap-2 overflow-x-auto py-2">
      <div className="shrink-0 p-3 rounded-2xl glass-inset border border-black/10 dark:border-white/10 text-center min-w-[90px]">
        <span className="text-xs text-zinc-500 dark:text-white/65 uppercase font-bold tracking-wider">
          Input
        </span>
        <div className="text-xs font-mono font-semibold text-zinc-900 dark:text-white mt-0.5">
          [{inputShape.join(',')}]
        </div>
      </div>

      {layers.map((layer) => (
        <React.Fragment key={layer.id}>
          <ArrowRight className="w-3.5 h-3.5 text-zinc-400 dark:text-white/30 shrink-0" />
          <div className="shrink-0 p-3 rounded-2xl glass-inset border border-black/10 dark:border-white/10 text-center min-w-[95px]">
            <span className="text-xs text-zinc-800 dark:text-white/80 uppercase font-bold tracking-wider">
              {layer.type}
            </span>
            <div className="text-xs font-mono font-semibold text-zinc-900 dark:text-white mt-0.5">
              {layer.units ? `${layer.units}u` : ''}
              {layer.filters ? `${layer.filters}f` : ''}
              {layer.rate != null ? `r=${layer.rate}` : ''}
            </div>
            {layer.activation && (
              <span className="inline-block text-xs px-1.5 py-0.2 rounded-full bg-black/5 dark:bg-white/10 text-zinc-700 dark:text-white/70 font-mono mt-1 border border-black/10 dark:border-white/10">
                {layer.activation}
              </span>
            )}
          </div>
        </React.Fragment>
      ))}

      <ArrowRight className="w-3.5 h-3.5 text-zinc-400 dark:text-white/30 shrink-0" />
      <div className="shrink-0 p-3 rounded-2xl glass-inset border border-black/15 dark:border-white/20 text-center min-w-[90px]">
        <span className="text-xs text-zinc-700 dark:text-white/60 uppercase font-bold tracking-wider">
          Output
        </span>
        <div className="text-xs font-mono font-semibold text-zinc-900 dark:text-white mt-0.5">
          {validation ? JSON.stringify(validation.outputShape) : '—'}
        </div>
      </div>
    </div>
  );

  if (!activeProject) {
    return (
      <ProjectRequiredPage
        icon={Cpu}
        eyebrow="Módulo 04 • Diseñador de Arquitecturas"
        title="Topologías & Validación Dimensional"
        description="Validación matemática de tensores en FastAPI y persistencia por proyecto. La UI no sustituye la validación del servidor."
        action="Seleccione un proyecto para diseñar y guardar arquitecturas de red."
      />
    );
  }

  const memoryKB = validation ? ((validation.totalParameters * 4) / 1024).toFixed(1) : '—';

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-black/10 dark:border-white/10">
        <div>
          <div className="flex items-center gap-2 text-zinc-600 dark:text-white/60 text-xs font-semibold uppercase tracking-wider">
            <Cpu className="w-4 h-4 text-zinc-800 dark:text-white/80" /> Módulo 04 • Diseñador de
            Arquitecturas
          </div>
          <h1 className="text-xl sm:text-2xl font-semibold text-zinc-900 dark:text-white mt-1">
            Topologías & Validación Dimensional
          </h1>
          <p className="text-xs text-zinc-600 dark:text-white/65 mt-0.5">
            Validación matemática de tensores en FastAPI y persistencia por proyecto. La UI no
            sustituye la validación del servidor.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadSaved}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl glass-btn-secondary text-xs font-medium"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${savedLoading ? 'animate-spin' : ''}`} /> Actualizar
          </button>
          <button
            onClick={handleSave}
            disabled={!validation?.valid || saving || !canWrite}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-xs transition-colors shadow-glass-sm ${
              validation?.valid && canWrite
                ? 'glass-btn-primary'
                : 'glass-btn-secondary opacity-40 cursor-not-allowed'
            }`}
            title={!canWrite ? 'Su rol no permite crear arquitecturas' : undefined}
          >
            <Save className="w-4 h-4" />
            {saving ? 'Guardando…' : 'Guardar Arquitectura'}
          </button>
        </div>
      </div>

      {/* Paso 1 · Dataset */}
      <div className="glass-card p-4 rounded-2xl space-y-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-900 dark:text-white/90 flex items-center gap-1.5">
            <Database className="w-4 h-4 text-zinc-600 dark:text-white/70" /> Paso 1 · Conjunto de datos de
            entrenamiento
          </span>
          <button
            onClick={() => onNavigate?.('datasets')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl glass-btn-secondary text-xs font-medium"
          >
            <Upload className="w-3.5 h-3.5" /> Subir / gestionar CSV
          </button>
        </div>

        {datasetsLoading && <LoadingBlock label="Cargando conjuntos de datos del proyecto…" />}
        {!datasetsLoading && datasetsError && (
          <ErrorBlock message={datasetsError} onRetry={loadDatasets} />
        )}

        {!datasetsLoading && !datasetsError && datasets.length === 0 && (
          <div className="glass-inset rounded-xl border border-black/10 dark:border-white/10 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-xs text-zinc-600 dark:text-white/60 leading-relaxed">
              El flujo comienza por el conjunto de datos: suba el CSV con su columna objetivo y aquí
              se calcularán las neuronas de entrada y salida reales del modelo.
            </p>
            <button
              onClick={() => onNavigate?.('datasets')}
              className="shrink-0 px-3 py-2 rounded-xl glass-btn-primary text-xs font-semibold"
            >
              Ir a conjuntos de datos
            </button>
          </div>
        )}

        {!datasetsLoading && !datasetsError && datasets.length > 0 && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 items-end">
              <div>
                <label className="block text-zinc-600 dark:text-white/65 font-medium mb-1.5">
                  CSV seleccionado
                </label>
                <select
                  value={datasetId}
                  onChange={(event) => setDatasetId(event.target.value)}
                  className="w-full glass-input rounded-xl px-3 py-1.5"
                >
                  {datasets.map((dataset) => (
                    <option key={dataset.id} value={dataset.id}>
                      {dataset.name} · {dataset.metadata.samples} filas
                      {dataset.metadata.targetColumn
                        ? ` · objetivo: ${dataset.metadata.targetColumn}`
                        : ' · sin objetivo'}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap gap-1.5 md:justify-end">
                <span className="text-xs px-2 py-1 rounded-full bg-black/5 dark:bg-white/10 text-zinc-700 dark:text-white/70 border border-black/10 dark:border-white/10">
                  {selectedDataset?.metadata.samples ?? 0} filas
                </span>
                <span className="text-xs px-2 py-1 rounded-full bg-black/5 dark:bg-white/10 text-zinc-700 dark:text-white/70 border border-black/10 dark:border-white/10">
                  {selectedDataset?.metadata.task === 'regression'
                    ? 'Regresión'
                    : selectedDataset?.metadata.task === 'classification'
                      ? 'Clasificación'
                      : 'Tarea sin definir'}
                </span>
                <span className="text-xs px-2 py-1 rounded-full bg-black/5 dark:bg-white/10 text-zinc-700 dark:text-white/70 border border-black/10 dark:border-white/10">
                  objetivo: {selectedDataset?.metadata.targetColumn || '—'}
                </span>
              </div>
            </div>

            {neuronSummary?.available ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { label: 'Neuronas de entrada', value: neuronSummary.inputNeurons },
                    { label: 'Neuronas de salida', value: neuronSummary.outputNeurons },
                    { label: 'Capas ocultas', value: Math.max(0, hiddenLayers.length) },
                    { label: 'Neuronas ocultas', value: hiddenUnits },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="glass-inset rounded-xl border border-black/10 dark:border-white/10 p-2.5 text-center"
                    >
                      <span className="block text-xs uppercase tracking-wider text-zinc-500 dark:text-white/65 font-semibold">
                        {item.label}
                      </span>
                      <span className="block text-base font-semibold font-mono text-zinc-900 dark:text-white mt-0.5">
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-600 dark:text-white/60">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-300 border border-violet-500/25">
                    <Lock className="w-3 h-3" /> Entrada y salida calculadas del CSV
                  </span>
                  <span>
                    Activación de salida: <strong>{neuronSummary.outputActivation}</strong>
                  </span>
                  {neuronSummary.loss && (
                    <span>
                      Pérdida: <strong>{neuronSummary.loss}</strong>
                    </span>
                  )}
                  {neuronSummary.classCount > 0 && (
                    <span>
                      <strong>{neuronSummary.classCount}</strong> clases
                    </span>
                  )}
                </div>

                <details className="text-xs text-zinc-600 dark:text-white/60">
                  <summary className="cursor-pointer text-zinc-700 dark:text-white/70 font-medium">
                    Ver desglose de neuronas de entrada
                  </summary>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1 font-mono">
                    {neuronSummary.features.map((feature) => (
                      <div
                        key={feature.name}
                        className="flex items-center justify-between gap-2 px-2 py-1 rounded-lg glass-inset"
                      >
                        <span className="truncate">{feature.name}</span>
                        <span className="shrink-0 text-zinc-900 dark:text-white/80">
                          {feature.neurons} · {feature.kind}
                        </span>
                      </div>
                    ))}
                  </div>
                  {neuronSummary.truncated && (
                    <p className="mt-1 text-zinc-500 dark:text-white/65">
                      Listado truncado; el conteo total sí incluye todas las columnas.
                    </p>
                  )}
                </details>
              </>
            ) : (
              <p className="text-xs text-amber-700 dark:text-amber-300 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                {neuronSummary?.reason ||
                  'El conjunto de datos no tiene columna objetivo. Súbalo de nuevo indicando el objetivo para calcular las neuronas.'}
              </p>
            )}
          </>
        )}

        <p className="text-xs text-zinc-500 dark:text-white/65">
          Las neuronas de entrada y salida las impone el CSV. Usted decide las capas ocultas y cuántas
          neuronas tiene cada una.
        </p>
      </div>

      {!canWrite && (
        <div className="glass-card p-3 rounded-2xl border border-amber-500/25 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          Su rol ({currentRole}) permite consultar y validar topologías, pero no guardar cambios.
        </div>
      )}

      {/* Paso 2 · Diseño */}
      <div className="glass-card p-5 rounded-2xl space-y-3.5 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-900 dark:text-white/90 flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-zinc-600 dark:text-white/70" /> Paso 2 · Diseño de la
            red
          </span>
          <span
            className={`text-xs font-mono px-2 py-1 rounded-full border ${
              FAMILY_TRAINABLE[family]
                ? 'text-emerald-700 dark:text-emerald-300 border-emerald-500/30 bg-emerald-500/10'
                : 'text-amber-700 dark:text-amber-300 border-amber-500/30 bg-amber-500/10'
            }`}
          >
            {FAMILY_TRAINABLE[family]
              ? 'Entrenable con CSV (requiere conjunto de datos)'
              : 'Solo diseño · entrenamiento no disponible'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          <div>
            <label className="block text-zinc-600 dark:text-white/65 font-medium mb-1.5">
              Nombre
            </label>
            <input
              type="text"
              value={archName}
              onChange={(event) => setArchName(event.target.value)}
              className="w-full glass-input rounded-xl px-3 py-1.5"
              maxLength={200}
            />
          </div>

          <div>
            <label className="block text-zinc-600 dark:text-white/65 font-medium mb-1.5">
              Familia
            </label>
            <select
              value={family}
              onChange={(event) => handleFamilyChange(event.target.value as NetworkFamily)}
              className="w-full glass-input rounded-xl px-3 py-1.5"
            >
              {(Object.keys(FAMILY_LABELS) as NetworkFamily[]).map((key) => (
                <option key={key} value={key}>
                  {FAMILY_LABELS[key]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {family === 'FEEDFORWARD' && datasetReady ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="glass-inset rounded-xl border border-black/10 dark:border-white/10 p-3">
              <span className="flex items-center gap-1 text-xs uppercase tracking-wider text-zinc-500 dark:text-white/65 font-semibold">
                <Lock className="w-3 h-3" /> Neuronas de entrada
              </span>
              <span className="block text-lg font-semibold font-mono text-zinc-900 dark:text-white mt-1">
                {neuronSummary!.inputNeurons}
              </span>
              <span className="block text-xs text-zinc-500 dark:text-white/65 mt-0.5">
                Fijadas por las columnas del CSV
              </span>
            </div>

            <div className="glass-inset rounded-xl border border-black/10 dark:border-white/10 p-3">
              <span className="flex items-center gap-1 text-xs uppercase tracking-wider text-zinc-500 dark:text-white/65 font-semibold">
                <Lock className="w-3 h-3" /> Neuronas de salida
              </span>
              <span className="block text-lg font-semibold font-mono text-zinc-900 dark:text-white mt-1">
                {neuronSummary!.outputNeurons}
              </span>
              <span className="block text-xs text-zinc-500 dark:text-white/65 mt-0.5">
                Activación {neuronSummary!.outputActivation}
              </span>
            </div>

            <div className="glass-inset rounded-xl border border-emerald-500/25 p-3">
              <span className="block text-xs uppercase tracking-wider text-zinc-500 dark:text-white/65 font-semibold">
                Neuronas ocultas (editables)
              </span>
              <span className="block text-lg font-semibold font-mono text-emerald-600 dark:text-emerald-300 mt-1">
                {hiddenUnits}
              </span>
              <span className="block text-xs text-zinc-500 dark:text-white/65 mt-0.5">
                {hiddenLayers.length} capa(s) antes de la salida
              </span>
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-zinc-600 dark:text-white/65 font-medium mb-1.5">
              Input Shape
            </label>
            <div className="flex items-center gap-2">
              {inputShape.map((dim, index) => (
                <div key={`${family}-${index}`} className="flex-1 min-w-0">
                  <span className="block text-xs uppercase tracking-wider text-zinc-500 dark:text-white/65 mb-0.5">
                    {SHAPE_LABELS[family][index]}
                  </span>
                  <input
                    type="number"
                    min="1"
                    value={dim}
                    onChange={(event) => updateShapeDim(index, parseInt(event.target.value, 10))}
                    className="w-full glass-input rounded-xl px-3 py-1.5 font-mono"
                  />
                </div>
              ))}
            </div>
            {family === 'FEEDFORWARD' && (
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                Seleccione un conjunto de datos con columna objetivo para fijar las neuronas de entrada y salida, o
                ajústelas manualmente.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-black/5 dark:border-white/5">
          <span className="text-xs text-zinc-500 dark:text-white/65 mr-1">Plantillas:</span>
          {(Object.keys(PRESETS) as NetworkFamily[]).map((key) => (
            <button
              key={key}
              onClick={() => applyPreset(key)}
              className={`px-2.5 py-1 rounded-xl border text-xs font-medium transition-colors ${
                family === key
                  ? 'border-zinc-900/30 dark:border-white/30 bg-black/5 dark:bg-white/10 text-zinc-900 dark:text-white'
                  : 'border-black/10 dark:border-white/10 glass-inset hover:border-black/25 dark:hover:border-white/25 text-zinc-700 dark:text-white/70'
              }`}
            >
              {FAMILY_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Layers editor */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-semibold text-zinc-900 dark:text-white/90 flex items-center gap-1.5 uppercase tracking-wider">
              <Layers className="w-4 h-4 text-zinc-600 dark:text-white/70" /> Secuencia de Capas (
              {layers.length})
            </h2>
            <div className="flex flex-wrap items-center gap-1 text-xs">
              {FAMILY_PALETTE[family].map((type) => (
                <button
                  key={type}
                  onClick={() => addLayer(type)}
                  className="px-2.5 py-1 rounded-xl glass-inset hover:bg-black/5 dark:hover:bg-white/10 text-zinc-800 dark:text-white/80 border border-black/10 dark:border-white/10 flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> {type}
                </button>
              ))}
            </div>
          </div>

          {layers.length === 0 ? (
            <EmptyBlock
              title="Sin capas configuradas"
              description="Añada al menos una capa Dense de salida para validar la arquitectura."
              icon={Layers}
            />
          ) : (
            <div className="space-y-2">
              {layers.map((layer, index) => {
                const isOutputLayer = outputLocked && index === layers.length - 1;
                return (
                <div
                  key={layer.id}
                  className={`glass-card p-3 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
                    isOutputLayer ? 'border border-violet-500/30' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {isOutputLayer ? (
                      <span
                        className="p-0.5 text-violet-600 dark:text-violet-300"
                        title="Capa de salida fijada por el conjunto de datos"
                      >
                        <Lock className="w-3.5 h-3.5" />
                      </span>
                    ) : (
                      <div className="flex flex-col gap-0.5">
                        <button
                          onClick={() => moveLayer(index, 'up')}
                          disabled={index === 0}
                          className="p-0.5 text-zinc-400 dark:text-white/65 hover:text-zinc-900 dark:hover:text-white disabled:opacity-20"
                        >
                          <MoveUp className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => moveLayer(index, 'down')}
                          disabled={index === layers.length - 1}
                          className="p-0.5 text-zinc-400 dark:text-white/65 hover:text-zinc-900 dark:hover:text-white disabled:opacity-20"
                        >
                          <MoveDown className="w-3 h-3" />
                        </button>
                      </div>
                    )}

                    <span className="w-5 h-5 rounded-lg glass-inset text-zinc-700 dark:text-white/70 font-mono text-xs flex items-center justify-center font-bold">
                      {index + 1}
                    </span>

                    <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded-full glass-inset text-zinc-900 dark:text-white border border-black/10 dark:border-white/10">
                      {layer.type}
                    </span>

                    {isOutputLayer && (
                      <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-300 border border-violet-500/25">
                        Salida · conjunto de datos
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    {(layer.type === 'Dense' || layer.type === 'LSTM' || layer.type === 'GRU') && (
                      <label className="flex items-center gap-1">
                        <span className="text-zinc-500 dark:text-white/65">Unidades</span>
                        {isOutputLayer ? (
                          <span className="w-16 glass-inset rounded-lg px-2 py-0.5 text-xs font-mono text-center text-zinc-900 dark:text-white">
                            {layer.units ?? 32}
                          </span>
                        ) : (
                          <input
                            type="number"
                            min="1"
                            value={layer.units ?? 32}
                            onChange={(event) =>
                              patchLayer(layer.id, {
                                units: Math.max(1, parseInt(event.target.value, 10) || 1),
                              })
                            }
                            className="w-16 glass-input rounded-lg px-2 py-0.5 text-xs font-mono"
                          />
                        )}
                      </label>
                    )}

                    {(layer.type === 'Dense' ||
                      layer.type === 'Conv1D' ||
                      layer.type === 'Conv2D') && (
                      <label className="flex items-center gap-1">
                        <span className="text-zinc-500 dark:text-white/65">Activación</span>
                        {isOutputLayer ? (
                          <span className="glass-inset rounded-lg px-2 py-0.5 text-xs font-mono text-zinc-900 dark:text-white">
                            {layer.activation || 'linear'}
                          </span>
                        ) : (
                          <select
                            value={layer.activation || 'relu'}
                            onChange={(event) =>
                              patchLayer(layer.id, {
                                activation: event.target.value as ActivationFunction,
                              })
                            }
                            className="glass-input rounded-lg px-2 py-0.5 text-xs"
                          >
                            {ACTIVATIONS.map((activation) => (
                              <option key={activation} value={activation}>
                                {activation}
                              </option>
                            ))}
                          </select>
                        )}
                      </label>
                    )}

                    {layer.type === 'Dropout' && (
                      <label className="flex items-center gap-1">
                        <span className="text-zinc-500 dark:text-white/65">Rate</span>
                        <input
                          type="number"
                          step="0.05"
                          min="0"
                          max="0.95"
                          value={layer.rate ?? 0.2}
                          onChange={(event) =>
                            patchLayer(layer.id, {
                              rate: Math.min(0.95, Math.max(0, parseFloat(event.target.value) || 0)),
                            })
                          }
                          className="w-16 glass-input rounded-lg px-2 py-0.5 text-xs font-mono"
                        />
                      </label>
                    )}

                    {(layer.type === 'Conv1D' || layer.type === 'Conv2D') && (
                      <>
                        <label className="flex items-center gap-1">
                          <span className="text-zinc-500 dark:text-white/65">Filtros</span>
                          <input
                            type="number"
                            min="1"
                            value={layer.filters ?? 32}
                            onChange={(event) =>
                              patchLayer(layer.id, {
                                filters: Math.max(1, parseInt(event.target.value, 10) || 1),
                              })
                            }
                            className="w-16 glass-input rounded-lg px-2 py-0.5 text-xs font-mono"
                          />
                        </label>
                        <label className="flex items-center gap-1">
                          <span className="text-zinc-500 dark:text-white/65">Kernel</span>
                          <input
                            type="number"
                            min="1"
                            value={
                              Array.isArray(layer.kernelSize)
                                ? layer.kernelSize[0] ?? 3
                                : layer.kernelSize ?? 3
                            }
                            onChange={(event) => {
                              const size = Math.max(1, parseInt(event.target.value, 10) || 1);
                              patchLayer(layer.id, {
                                kernelSize: layer.type === 'Conv1D' ? [size] : [size, size],
                              });
                            }}
                            className="w-14 glass-input rounded-lg px-2 py-0.5 text-xs font-mono"
                          />
                        </label>
                      </>
                    )}

                    {(layer.type === 'MaxPooling1D' || layer.type === 'MaxPooling2D') && (
                      <label className="flex items-center gap-1">
                        <span className="text-zinc-500 dark:text-white/65">Pool</span>
                        <input
                          type="number"
                          min="1"
                          value={
                            Array.isArray(layer.poolSize)
                              ? layer.poolSize[0] ?? 2
                              : layer.poolSize ?? 2
                          }
                          onChange={(event) => {
                            const size = Math.max(1, parseInt(event.target.value, 10) || 1);
                            patchLayer(layer.id, {
                              poolSize: layer.type === 'MaxPooling1D' ? [size] : [size, size],
                            });
                          }}
                          className="w-14 glass-input rounded-lg px-2 py-0.5 text-xs font-mono"
                        />
                      </label>
                    )}

                    {(layer.type === 'LSTM' ||
                      layer.type === 'GRU' ||
                      layer.type === 'SimpleRNN') && (
                      <label className="flex items-center gap-1.5 text-zinc-500 dark:text-white/60">
                        <input
                          type="checkbox"
                          checked={Boolean(layer.returnSequences)}
                          onChange={(event) =>
                            patchLayer(layer.id, { returnSequences: event.target.checked })
                          }
                          className="rounded accent-zinc-900 dark:accent-white"
                        />
                        return_sequences
                      </label>
                    )}

                    <button
                      onClick={() => removeLayer(layer.id)}
                      disabled={isOutputLayer}
                      className="p-1 text-zinc-400 dark:text-white/65 hover:text-red-500 transition-colors disabled:opacity-20 disabled:hover:text-zinc-400 dark:disabled:hover:text-white/65"
                      title={isOutputLayer ? 'La salida la define el conjunto de datos' : 'Eliminar capa'}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
          )}

          {/* Saved architectures */}
          <div className="glass-card p-4 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-zinc-900 dark:text-white/90 flex items-center gap-1.5 uppercase tracking-wider">
                <FolderGit2 className="w-3.5 h-3.5 text-zinc-600 dark:text-white/70" /> Arquitecturas
                guardadas
              </h3>
              <span className="text-xs text-zinc-500 dark:text-white/65">
                {saved.length} en este proyecto
              </span>
            </div>

            {savedLoading && <LoadingBlock label="Cargando arquitecturas…" />}
            {!savedLoading && savedError && (
              <ErrorBlock message={savedError} onRetry={loadSaved} />
            )}
            {!savedLoading && !savedError && saved.length === 0 && (
              <EmptyBlock
                title="Aún no hay arquitecturas"
                description="Valide y guarde su primera topología para usarla en Entrenamientos."
                icon={Cpu}
              />
            )}
            {!savedLoading && !savedError && saved.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {saved.map((architecture) => (
                  <button
                    key={architecture.id}
                    onClick={() => loadArchitecture(architecture)}
                    className="text-left p-3 rounded-xl glass-inset border border-black/10 dark:border-white/10 hover:border-black/25 dark:hover:border-white/25 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-zinc-900 dark:text-white truncate">
                        {architecture.name}
                      </span>
                      <span className="text-xs font-mono text-zinc-500 dark:text-white/65 shrink-0">
                        v{architecture.version}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-white/65 mt-1 font-mono">
                      <span>{architecture.family}</span>
                      <span>{formatDate(architecture.createdAt)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right dock */}
        <div className="space-y-3.5">
          <div className="text-xs font-medium text-zinc-600 dark:text-white/65 flex items-center justify-between px-1">
            <span>Validación del servidor</span>
            <span className="text-xs text-zinc-800 dark:text-white/70">
              {validating ? 'Validando…' : validation ? 'Sincronizada' : 'Pendiente'}
            </span>
          </div>

          <div
            onClick={() => validation && setEnlargedTopologyOpen(true)}
            className="glass-card p-4 rounded-2xl glass-card-hover cursor-pointer space-y-2"
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-zinc-900 dark:text-white/90 flex items-center gap-1">
                <Workflow className="w-3.5 h-3.5 text-zinc-600 dark:text-white/70" /> Grafo de
                Topología
              </span>
              <Maximize2 className="w-3 h-3 text-zinc-400 dark:text-white/65" />
            </div>

            <div className="p-2 glass-inset rounded-xl overflow-hidden">{renderTopologyFlow()}</div>
            <div className="flex justify-between items-center text-xs text-zinc-500 dark:text-white/65 px-0.5">
              <span>{layers.length} capas encadenadas</span>
              <span className="text-zinc-800 dark:text-white/70 font-medium">Ampliar →</span>
            </div>
          </div>

          <div className="glass-card p-4 rounded-2xl space-y-2 text-xs text-zinc-600 dark:text-white/60">
            <span className="font-semibold text-zinc-900 dark:text-white/90 block border-b border-black/10 dark:border-white/10 pb-1.5">
              Resumen Técnico Keras
            </span>

            <div className="flex justify-between">
              <span>Parámetros totales</span>
              <span className="font-mono font-medium text-zinc-900 dark:text-white">
                {validation ? validation.totalParameters.toLocaleString() : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Entrenables</span>
              <span className="font-mono font-medium text-zinc-900 dark:text-white">
                {validation ? validation.trainableParameters.toLocaleString() : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Memoria de pesos</span>
              <span className="font-mono text-zinc-700 dark:text-white/80">
                {memoryKB} {validation ? 'KB' : ''}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Salida del grafo</span>
              <span className="font-mono text-zinc-900 dark:text-white font-medium">
                {validation ? JSON.stringify(validation.outputShape) : '—'}
              </span>
            </div>
            <div className="flex justify-between items-center pt-1 border-t border-black/5 dark:border-white/5">
              <span>Entrenable</span>
              <span
                className={`font-semibold ${
                  validation?.trainable
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-600 dark:text-amber-300'
                }`}
              >
                {validation ? (validation.trainable ? 'Sí' : 'No') : '—'}
              </span>
            </div>
            {validation?.trainableReason && (
              <p className="text-xs text-amber-600 dark:text-amber-300 leading-snug">
                {validation.trainableReason}
              </p>
            )}
          </div>

          {validationError && <ErrorBlock message={validationError} />}

          {validation && (
            <div className="space-y-2">
              {validation.errors.length > 0 && (
                <div className="glass-card p-3 rounded-2xl border border-rose-500/25 text-xs text-rose-600 dark:text-rose-300 space-y-1">
                  <span className="font-semibold flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> Errores de validación
                  </span>
                  {validation.errors.map((error, index) => (
                    <p key={index}>• {error}</p>
                  ))}
                </div>
              )}
              {validation.warnings.length > 0 && (
                <div className="glass-card p-3 rounded-2xl border border-amber-500/25 text-xs text-amber-700 dark:text-amber-300 space-y-1">
                  <span className="font-semibold flex items-center gap-1">
                    <Info className="w-3.5 h-3.5" /> Advertencias
                  </span>
                  {validation.warnings.map((warning, index) => (
                    <p key={index}>• {warning}</p>
                  ))}
                </div>
              )}
              {validation.valid && (
                <div className="glass-inset p-3 rounded-2xl border border-emerald-500/25 text-xs text-emerald-600 dark:text-emerald-300 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 shrink-0" /> Topología válida según el validador
                  del servidor.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <EnlargedChartModal
        isOpen={enlargedTopologyOpen}
        onClose={() => setEnlargedTopologyOpen(false)}
        title={`Grafo de Topología Neuronal: ${archName}`}
        subtitle="Flujo completo de transformación de tensores verificado dimensionalmente"
        badge={family}
      >
        <div className="space-y-4">
          <div className="p-6 glass-inset rounded-2xl border border-black/10 dark:border-white/10">
            {renderTopologyFlow()}
          </div>

          <div className="p-3.5 rounded-2xl glass-inset border border-black/10 dark:border-white/10 text-xs text-zinc-700 dark:text-white/70 space-y-1">
            <div>
              • Total parámetros:{' '}
              <strong>{validation?.totalParameters.toLocaleString() ?? '—'}</strong> (
              {validation?.trainableParameters.toLocaleString() ?? '—'} entrenables)
            </div>
            <div>
              • Memoria aproximada de pesos: <strong>{memoryKB} KB</strong>
            </div>
            <div>
              • Tensor de salida:{' '}
              <strong>{validation ? JSON.stringify(validation.outputShape) : '—'}</strong>
            </div>
          </div>
        </div>
      </EnlargedChartModal>
    </div>
  );
};
