import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PlayCircle,
  StopCircle,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Activity,
  Clock,
  Terminal,
  Sliders,
  Maximize2,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  FolderGit2,
  Database,
  Radio,
} from 'lucide-react';
import { useApp } from '../../lib/AppContext';
import { ApiClient } from '../../lib/api';
import type { GuidedTarget } from '../../lib/guidedFlow';
import { useTrainingTelemetry } from '../../hooks/useTrainingTelemetry';
import { EnlargedChartModal } from '../../components/common/EnlargedChartModal';
import {
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  ProjectRequiredPage,
} from '../../components/common/ProjectGuard';
import {
  formatDateTime,
  formatDuration,
  formatMetric,
  formatPercent,
  shortId,
} from '../../lib/format';
import {
  FAMILY_LABELS,
  JOB_STATUS_LABELS,
  ROLE_LABELS,
  labelFor,
} from '../../lib/labels';
import {
  Architecture,
  Dataset,
  JobStatus,
  TrainingJob,
  TrainingMetric,
} from '../../types';

const WRITE_ROLES = ['ADMIN', 'PROJECT_LEAD', 'AI_ENGINEER'];
const ACTIVE_STATES: JobStatus[] = ['QUEUED', 'PREPARING', 'RUNNING'];
const TERMINAL_STATES: JobStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

const STATUS_STYLES: Record<JobStatus, string> = {
  QUEUED: 'text-zinc-700 dark:text-white/80 border-black/15 dark:border-white/20',
  PREPARING: 'text-amber-700 dark:text-amber-300 border-amber-500/30',
  RUNNING: 'text-sky-700 dark:text-sky-300 border-sky-500/30',
  COMPLETED: 'text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  FAILED: 'text-rose-700 dark:text-rose-300 border-rose-500/30',
  CANCELLED: 'text-amber-700 dark:text-amber-300 border-amber-500/30',
};

function StatusPill({ status }: { status: JobStatus }) {
  const isActive = ACTIVE_STATES.includes(status);
  const isDone = status === 'COMPLETED';
  const isError = status === 'FAILED';
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold glass-inset border ${STATUS_STYLES[status]}`}
    >
      {isActive && <Loader2 className="w-3 h-3 animate-spin" />}
      {isDone && <CheckCircle2 className="w-3 h-3" />}
      {isError && <AlertTriangle className="w-3 h-3" />}
      {labelFor(JOB_STATUS_LABELS, status)}
    </span>
  );
}

function formatSeconds(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes} min ${rest} s`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

interface ChartProps {
  metrics: TrainingMetric[];
  metric: 'loss' | 'accuracy';
  totalEpochs: number;
  isLarge?: boolean;
}

/** Devuelve la época con mejor métrica de validación (o entrenamiento si no hay validación). */
function bestEpochFor(metrics: TrainingMetric[], metric: 'loss' | 'accuracy'): number | null {
  const valKey = metric === 'loss' ? 'valLoss' : 'valAccuracy';
  const withValidation = metrics.filter((point) => {
    const value = point[valKey];
    return typeof value === 'number' && Number.isFinite(value);
  });
  const pool = withValidation.length
    ? withValidation
    : metrics.filter((point) => {
        const value = point[metric];
        return typeof value === 'number' && Number.isFinite(value);
      });
  if (!pool.length) return null;

  const isBetter = (candidate: number, current: number) =>
    metric === 'loss' ? candidate < current : candidate > current;

  let best = pool[0];
  let bestValue = (best[valKey] ?? best[metric]) as number;
  for (const point of pool.slice(1)) {
    const value = (point[valKey] ?? point[metric]) as number;
    if (isBetter(value, bestValue)) {
      best = point;
      bestValue = value;
    }
  }
  return best.epoch;
}

function MetricChart({ metrics, metric, totalEpochs, isLarge = false }: ChartProps) {
  const trainKey = metric;
  const valKey = metric === 'loss' ? 'valLoss' : 'valAccuracy';

  const trainSeries = metrics
    .map((point) => ({ epoch: point.epoch, value: point[trainKey] }))
    .filter((point): point is { epoch: number; value: number } =>
      typeof point.value === 'number' && Number.isFinite(point.value),
    );

  if (!trainSeries.length) {
    return (
      <div className="h-28 flex items-center justify-center text-xs text-zinc-600 dark:text-white/65 font-mono">
        Esperando datos reales del worker…
      </div>
    );
  }

  const valSeries = metrics
    .map((point) => ({ epoch: point.epoch, value: point[valKey] }))
    .filter((point): point is { epoch: number; value: number } =>
      typeof point.value === 'number' && Number.isFinite(point.value),
    );

  const width = isLarge ? 720 : 260;
  const height = isLarge ? 280 : 100;
  const padding = isLarge ? 38 : 14;
  const maxEpoch = Math.max(totalEpochs, ...metrics.map((point) => point.epoch), 1);
  const allValues = [...trainSeries, ...valSeries].map((point) => point.value);
  let minValue = Math.min(...allValues);
  let maxValue = Math.max(...allValues);
  if (metric === 'accuracy') {
    minValue = Math.min(0, minValue);
    maxValue = Math.max(1, maxValue);
  } else if (maxValue === minValue) {
    maxValue = minValue + 1;
  }
  const span = maxValue - minValue || 1;

  const project = (epoch: number, value: number) => {
    const x = padding + ((epoch - 1) / Math.max(1, maxEpoch - 1)) * (width - 2 * padding);
    const y = height - padding - ((value - minValue) / span) * (height - 2 * padding);
    return [x, y] as const;
  };

  const trainPositions = trainSeries.map((point) => ({ ...point, xy: project(point.epoch, point.value) }));
  const valPositions = valSeries.map((point) => ({ ...point, xy: project(point.epoch, point.value) }));
  const trainPoints = trainPositions.map((point) => `${point.xy[0].toFixed(1)},${point.xy[1].toFixed(1)}`);
  const valPoints = valPositions.map((point) => `${point.xy[0].toFixed(1)},${point.xy[1].toFixed(1)}`);

  const candidateSeries = valSeries.length ? valSeries : trainSeries;
  const bestPoint = candidateSeries.reduce((best, point) =>
    metric === 'loss'
      ? point.value < best.value
        ? point
        : best
      : point.value > best.value
        ? point
        : best,
  );
  const bestXY = project(bestPoint.epoch, bestPoint.value);
  const lastTrainPosition = trainPositions[trainPositions.length - 1];

  const formatAxis = (value: number) =>
    metric === 'accuracy' ? `${(value * 100).toFixed(0)}%` : value.toFixed(3);
  const metricLabel = metric === 'loss' ? 'pérdida' : 'exactitud';

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto overflow-visible select-none text-zinc-900 dark:text-white"
      role="img"
      aria-label={`Curva de ${metricLabel} con entrenamiento y validación. Mejor época: ${bestPoint.epoch}.`}
    >
      <line
        x1={padding}
        y1={height / 2}
        x2={width - padding}
        y2={height / 2}
        stroke="currentColor"
        strokeOpacity="0.10"
        strokeDasharray="3 3"
      />
      <line
        x1={padding}
        y1={height - padding}
        x2={width - padding}
        y2={height - padding}
        stroke="currentColor"
        strokeOpacity="0.22"
      />
      <line
        x1={padding}
        y1={padding}
        x2={padding}
        y2={height - padding}
        stroke="currentColor"
        strokeOpacity="0.22"
      />

      {isLarge && (
        <>
          <text
            x={padding - 8}
            y={padding + 4}
            fontSize="11"
            textAnchor="end"
            fill="currentColor"
            opacity="0.65"
            fontFamily="monospace"
          >
            {formatAxis(maxValue)}
          </text>
          <text
            x={padding - 8}
            y={height - padding}
            fontSize="11"
            textAnchor="end"
            fill="currentColor"
            opacity="0.65"
            fontFamily="monospace"
          >
            {formatAxis(minValue)}
          </text>
          <text
            x={width - padding}
            y={height - padding + 17}
            fontSize="11"
            textAnchor="end"
            fill="currentColor"
            opacity="0.65"
            fontFamily="monospace"
          >
            Época {maxEpoch}
          </text>
          <text x={padding} y={height - padding + 17} fontSize="11" fill="currentColor" opacity="0.65">
            Época 1
          </text>
        </>
      )}

      <defs>
        <filter id={`glow-${metric}`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor="var(--chart-train)" floodOpacity="0.55" />
        </filter>
      </defs>

      {/* Marcador de mejor época */}
      <line
        x1={bestXY[0]}
        y1={padding}
        x2={bestXY[0]}
        y2={height - padding}
        stroke="var(--chart-best)"
        strokeWidth="1"
        strokeDasharray="3 4"
        opacity="0.75"
      />
      <circle
        cx={bestXY[0]}
        cy={bestXY[1]}
        r={isLarge ? '4' : '2.5'}
        fill="var(--chart-best)"
        stroke="var(--canvas-bg)"
        strokeWidth="1.2"
      >
        <title>{`Mejor época ${bestPoint.epoch}: ${formatAxis(bestPoint.value)}`}</title>
      </circle>
      {isLarge && (
        <text
          x={Math.min(bestXY[0] + 7, width - padding - 78)}
          y={padding + 10}
          fontSize="11"
          fill="var(--chart-best)"
          fontFamily="monospace"
        >
          Mejor época {bestPoint.epoch}
        </text>
      )}

      <polyline
        fill="none"
        stroke="var(--chart-train)"
        strokeWidth={isLarge ? '2.5' : '2'}
        points={trainPoints.join(' ')}
        strokeLinecap="round"
        strokeLinejoin="round"
        filter={`url(#glow-${metric})`}
      />
      {valPoints.length > 1 && (
        <polyline
          fill="none"
          stroke="var(--chart-val)"
          strokeWidth={isLarge ? '2' : '1.5'}
          strokeDasharray="5 4"
          points={valPoints.join(' ')}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {isLarge &&
        trainPositions.map((point) => (
          <circle
            key={`train-${point.epoch}`}
            cx={point.xy[0]}
            cy={point.xy[1]}
            r="2.6"
            fill="var(--chart-train)"
            opacity="0.95"
          >
            <title>{`Época ${point.epoch} · Entrenamiento: ${formatAxis(point.value)}`}</title>
          </circle>
        ))}
      {isLarge &&
        valPositions.map((point) => (
          <circle
            key={`val-${point.epoch}`}
            cx={point.xy[0]}
            cy={point.xy[1]}
            r="2.6"
            fill="var(--chart-val)"
            opacity="0.95"
          >
            <title>{`Época ${point.epoch} · Validación: ${formatAxis(point.value)}`}</title>
          </circle>
        ))}

      {lastTrainPosition && (
        <circle
          cx={lastTrainPosition.xy[0]}
          cy={lastTrainPosition.xy[1]}
          r={isLarge ? '4.5' : '3.5'}
          fill="var(--chart-train)"
          stroke="var(--canvas-bg)"
          strokeWidth="1.5"
        >
          <title>{`Última época ${lastTrainPosition.epoch}: ${formatAxis(lastTrainPosition.value)}`}</title>
        </circle>
      )}
    </svg>
  );
}

interface TrainingManagerViewProps {
  guided?: GuidedTarget | null;
  onGuidedConsumed?: (id: number) => void;
}

export const TrainingManagerView: React.FC<TrainingManagerViewProps> = ({
  guided,
  onGuidedConsumed,
}) => {
  const { activeProject, currentRole, showToast } = useApp();
  const projectId = activeProject?.id;
  const canWrite = WRITE_ROLES.includes(currentRole);

  const [architectures, setArchitectures] = useState<Architecture[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [architectureId, setArchitectureId] = useState('');
  const [datasetId, setDatasetId] = useState('');
  const [targetColumn, setTargetColumn] = useState('');
  const [task, setTask] = useState<'classification' | 'regression' | ''>('');
  const [epochs, setEpochs] = useState(30);
  const [batchSize, setBatchSize] = useState(32);
  const [optimizer, setOptimizer] = useState<'adam' | 'sgd' | 'rmsprop' | 'adamw' | 'nadam'>('adam');
  const [learningRate, setLearningRate] = useState(0.001);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [enlargedModal, setEnlargedModal] = useState<'loss' | 'accuracy' | null>(null);

  const loadJobs = useCallback(async () => {
    if (!projectId) return [];
    const list = await ApiClient.listTrainingJobs(projectId);
    setJobs(list);
    setSelectedJobId((current) => {
      if (current && list.some((job) => job.id === current)) return current;
      return list[0]?.id ?? null;
    });
    return list;
  }, [projectId]);

  const loadAll = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [architectureList, datasetList] = await Promise.all([
        ApiClient.listArchitectures(projectId),
        ApiClient.listDatasets(projectId),
      ]);
      setArchitectures(architectureList);
      setDatasets(datasetList);
      await loadJobs();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible cargar los datos del módulo');
    } finally {
      setLoading(false);
    }
  }, [projectId, loadJobs]);

  useEffect(() => {
    setArchitectures([]);
    setDatasets([]);
    setJobs([]);
    setSelectedJobId(null);
    setArchitectureId('');
    setDatasetId('');
    setTargetColumn('');
    setTask('');
    setFormError(null);
    if (projectId) void loadAll();
  }, [projectId, loadAll]);

  const selectedArchitecture = useMemo(
    () => architectures.find((item) => item.id === architectureId) || null,
    [architectures, architectureId],
  );
  const selectedDataset = useMemo(
    () => datasets.find((item) => item.id === datasetId) || null,
    [datasets, datasetId],
  );
  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) || null,
    [jobs, selectedJobId],
  );

  const handleArchitectureChange = (id: string) => {
    setArchitectureId(id);
    const architecture = architectures.find((item) => item.id === id);
    if (architecture) {
      setFormError(
        architecture.family === 'FEEDFORWARD'
          ? null
          : `La familia ${architecture.family} está documentada, pero el MVP sólo entrena Feedforward con CSV tabular.`,
      );
    }
  };

  const handleDatasetChange = (id: string) => {
    setDatasetId(id);
    const dataset = datasets.find((item) => item.id === id);
    if (dataset) {
      setTargetColumn(dataset.targetColumn || dataset.metadata.targetColumn || '');
      setTask(dataset.metadata.task || '');
    }
  };

  // Flujo guiado: al venir del diseñador deja lista la arquitectura y el CSV
  // recién guardados, para que el usuario sólo revise y lance el trabajo.
  useEffect(() => {
    if (!guided) return;
    if (!guided.architectureId && !guided.datasetId) return;
    const architectureReady = guided.architectureId
      ? architectures.some((item) => item.id === guided.architectureId)
      : true;
    const datasetReady = guided.datasetId
      ? datasets.some((item) => item.id === guided.datasetId)
      : true;
    if (!architectureReady || !datasetReady) return;

    if (guided.architectureId) setArchitectureId(guided.architectureId);
    if (guided.datasetId) {
      const dataset = datasets.find((item) => item.id === guided.datasetId);
      setDatasetId(guided.datasetId);
      if (dataset) {
        setTargetColumn(dataset.targetColumn || dataset.metadata.targetColumn || '');
        setTask(dataset.metadata.task || '');
      }
    }
    onGuidedConsumed?.(guided.id);
    showToast(
      'Arquitectura y conjunto de datos preseleccionados. Revise los hiperparámetros y lance el entrenamiento.',
      'info',
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guided?.id, architectures, datasets]);

  const telemetry = useTrainingTelemetry(selectedJob?.id ?? null, {
    totalEpochs: selectedJob?.hyperparameters.epochs,
    initialMetrics: selectedJob?.metrics ?? [],
    initialStatus: selectedJob?.status ?? null,
    initialProgress: selectedJob?.progress ?? 0,
  });

  const effectiveStatus = telemetry.status || selectedJob?.status || null;
  const progress =
    effectiveStatus === 'COMPLETED'
      ? 100
      : Math.max(telemetry.progress, selectedJob?.progress ?? 0);
  const metrics = telemetry.metrics;
  const latestMetric = metrics[metrics.length - 1];
  const hasAccuracy = metrics.some((point) => typeof point.accuracy === 'number');
  const totalEpochs = selectedJob?.hyperparameters.epochs ?? telemetry.totalEpochs;
  const isActive = effectiveStatus ? ACTIVE_STATES.includes(effectiveStatus) : false;

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isActive) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [isActive]);

  const timing = useMemo(() => {
    if (!selectedJob?.startedAt || metrics.length === 0) {
      return { secondsPerEpoch: null as number | null, etaSeconds: null as number | null };
    }
    const start = new Date(selectedJob.startedAt).getTime();
    const end = selectedJob.endedAt ? new Date(selectedJob.endedAt).getTime() : now;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return { secondsPerEpoch: null, etaSeconds: null };
    }
    const secondsPerEpoch = (end - start) / 1000 / metrics.length;
    const target = totalEpochs || selectedJob.hyperparameters.epochs || metrics.length;
    const remaining = Math.max(0, target - metrics.length);
    return {
      secondsPerEpoch,
      etaSeconds: isActive ? remaining * secondsPerEpoch : null,
    };
  }, [selectedJob, metrics.length, totalEpochs, now, isActive]);

  const bestLossEpoch = useMemo(() => bestEpochFor(metrics, 'loss'), [metrics]);
  const bestAccuracyEpoch = useMemo(() => bestEpochFor(metrics, 'accuracy'), [metrics]);

  // Refresca la lista (estado persistido) cuando el SSE confirma un final.
  useEffect(() => {
    if (!selectedJob || !telemetry.status) return;
    if (
      TERMINAL_STATES.includes(telemetry.status) &&
      selectedJob.status !== telemetry.status &&
      projectId
    ) {
      void loadJobs();
    }
  }, [telemetry.status, selectedJob, projectId, loadJobs]);

  // Mantiene la tabla al día mientras existan trabajos activos.
  useEffect(() => {
    if (!projectId) return;
    if (!jobs.some((job) => ACTIVE_STATES.includes(job.status))) return;
    const interval = window.setInterval(() => {
      void loadJobs();
    }, 8000);
    return () => window.clearInterval(interval);
  }, [jobs, projectId, loadJobs]);

  const handleStart = async () => {
    if (!projectId) return;
    if (!architectureId) {
      setFormError('Seleccione una arquitectura guardada');
      return;
    }
    if (!datasetId) {
      setFormError('Seleccione un conjunto de datos verificado');
      return;
    }
    if (!targetColumn.trim()) {
      setFormError('Indique la columna objetivo del conjunto de datos');
      return;
    }
    setStarting(true);
    setFormError(null);
    try {
      const job = await ApiClient.startTraining(projectId, {
        architectureId,
        datasetId,
        targetColumn: targetColumn.trim(),
        task: task || undefined,
        epochs,
        batchSize,
        optimizer,
        learningRate,
      });
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
      setSelectedJobId(job.id);
      showToast('Trabajo encolado. La telemetría se actualizará sin recargar la página.', 'success');
      await loadJobs();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'No fue posible iniciar el entrenamiento',
      );
    } finally {
      setStarting(false);
    }
  };

  const handleCancel = async () => {
    if (!selectedJob) return;
    if (!window.confirm(`¿Solicitar la cancelación del trabajo ${shortId(selectedJob.id)}?`)) {
      return;
    }
    setCancelling(true);
    try {
      const result = await ApiClient.cancelTraining(selectedJob.id);
      const cancelledNow = result.status === 'CANCELLED';
      showToast(
        cancelledNow
          ? 'Trabajo cancelado antes de iniciar.'
          : 'Cancelación solicitada. El worker la aplicará al finalizar la época en curso.',
        cancelledNow ? 'success' : 'warning',
      );
      await telemetry.refresh();
      await loadJobs();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No fue posible cancelar el trabajo', 'error');
    } finally {
      setCancelling(false);
    }
  };

  const logs = useMemo(() => {
    const lines: string[] = [];
    if (!selectedJob) return lines;
    lines.push(
      `[${formatDateTime(selectedJob.createdAt)}] Trabajo ${shortId(selectedJob.id)} registrado con estado ${labelFor(JOB_STATUS_LABELS, selectedJob.status)}.`,
    );
    if (selectedJob.startedAt) {
      lines.push(`[${formatDateTime(selectedJob.startedAt)}] El worker inició la ejecución.`);
    }
    metrics.forEach((point) => {
      const parts = [`época ${point.epoch}/${totalEpochs}`];
      if (point.loss != null) parts.push(`pérdida=${formatMetric(point.loss)}`);
      if (point.accuracy != null) parts.push(`exactitud=${formatPercent(point.accuracy)}`);
      if (point.valLoss != null) parts.push(`pérdida_val=${formatMetric(point.valLoss)}`);
      if (point.valAccuracy != null) parts.push(`exactitud_val=${formatPercent(point.valAccuracy)}`);
      lines.push(parts.join(' · '));
    });
    if (selectedJob.endedAt) {
      lines.push(
        `[${formatDateTime(selectedJob.endedAt)}] El trabajo finalizó como ${labelFor(JOB_STATUS_LABELS, effectiveStatus)}.`,
      );
    }
    if (telemetry.errorMessage) {
      lines.push(`[ERROR] ${telemetry.errorMessage}`);
    }
    return lines.slice(-80);
  }, [selectedJob, metrics, totalEpochs, effectiveStatus, telemetry.errorMessage]);

  if (!activeProject) {
    return (
      <ProjectRequiredPage
        icon={PlayCircle}
        eyebrow="Módulo 06 • Orquestador de Entrenamientos"
        title="Ejecución Asíncrona & Telemetría"
        description="Entrenamiento real de TensorFlow/Keras en un worker aislado. La telemetría se persiste en PostgreSQL y llega por SSE con recuperación ante reconexiones."
        action="Seleccione un proyecto para iniciar y monitorear entrenamientos."
      />
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-black/10 dark:border-white/10">
        <div>
          <div className="flex items-center gap-2 text-zinc-600 dark:text-white/60 text-xs font-semibold uppercase tracking-wider">
            <PlayCircle className="w-4 h-4 text-zinc-800 dark:text-white/80" /> Módulo 06 •
            Orquestador de Entrenamientos
          </div>
          <h1 className="text-xl sm:text-2xl font-semibold text-zinc-900 dark:text-white mt-1">
            Ejecución Asíncrona & Telemetría
          </h1>
          <p className="text-xs text-zinc-600 dark:text-white/65 mt-0.5">
            Entrenamiento real de TensorFlow/Keras en un worker aislado. La telemetría se persiste en
            PostgreSQL y llega por SSE con recuperación ante reconexiones.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadAll}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl glass-btn-secondary text-xs font-medium"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Actualizar
          </button>
          {isActive && (
            <button
              onClick={handleCancel}
              disabled={cancelling || selectedJob?.cancelRequested || !canWrite}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-500/15 hover:bg-red-500/25 text-red-600 dark:text-red-300 border border-red-500/30 text-xs font-medium transition-colors disabled:opacity-50"
            >
              <StopCircle className="w-4 h-4" />{' '}
              {selectedJob?.cancelRequested
                ? 'Cancelación solicitada'
                : cancelling
                  ? 'Cancelando…'
                  : 'Cancelar trabajo'}
            </button>
          )}
          <button
            onClick={handleStart}
            disabled={starting || !canWrite}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl glass-btn-primary text-xs font-semibold disabled:opacity-50"
          >
            <PlayCircle className="w-4 h-4" /> {starting ? 'Encolando…' : 'Iniciar Entrenamiento'}
          </button>
        </div>
      </div>

      {error && <ErrorBlock message={error} onRetry={loadAll} />}
      {loading && <LoadingBlock label="Cargando arquitecturas, conjuntos de datos y trabajos…" />}

      {!canWrite && (
        <div className="glass-card p-3 rounded-2xl border border-amber-500/25 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Su rol ({labelFor(ROLE_LABELS, currentRole)}) permite consultar trabajos y métricas, pero no iniciar ni cancelar
          entrenamientos.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {/* Job status */}
          <div className="glass-card p-5 rounded-2xl space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-zinc-600 dark:text-white/60">
                  Trabajo seleccionado:
                </span>
                {selectedJob ? (
                  <span className="font-mono text-xs text-zinc-900 dark:text-white">
                    {shortId(selectedJob.id, 12)}
                  </span>
                ) : (
                  <span className="text-xs text-zinc-500 dark:text-white/65">Ninguno</span>
                )}
                {effectiveStatus && <StatusPill status={effectiveStatus} />}
                {selectedJob?.cancelRequested && isActive && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-300">
                    <AlertTriangle className="w-3 h-3" /> Cancelación pendiente
                  </span>
                )}
                {telemetry.isConnected && (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-300 font-medium">
                    <Radio className="w-3 h-3" /> SSE en vivo
                  </span>
                )}
              </div>
              <span className="font-mono text-xs font-semibold text-zinc-900 dark:text-white">
                {Math.round(progress)}%
              </span>
            </div>

            <div className="w-full h-2 rounded-full glass-inset overflow-hidden border border-black/10 dark:border-white/10">
              <div
                className={`h-full transition-all duration-300 rounded-full ${
                  effectiveStatus === 'FAILED'
                    ? 'bg-rose-500'
                    : effectiveStatus === 'CANCELLED'
                      ? 'bg-amber-500'
                      : effectiveStatus === 'COMPLETED'
                        ? 'bg-emerald-500'
                        : 'bg-sky-500'
                }`}
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            </div>

            {selectedJob && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-white/65 font-mono">
                <span>Creado: {formatDateTime(selectedJob.createdAt)}</span>
                <span>Duración: {formatDuration(selectedJob.startedAt, selectedJob.endedAt)}</span>
                <span>
                  Época: {telemetry.currentEpoch} / {totalEpochs || selectedJob.hyperparameters.epochs}
                </span>
                {telemetry.lastEventAt && (
                  <span>Último evento: {new Date(telemetry.lastEventAt).toLocaleTimeString()}</span>
                )}
              </div>
            )}

            {selectedJob?.errorMessage && (
              <p className="text-xs text-rose-600 dark:text-rose-300">{selectedJob.errorMessage}</p>
            )}
          </div>

          {/* Quick metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
            {[
              { label: 'Pérdida', value: formatMetric(latestMetric?.loss), tone: '', hint: 'entrenamiento' },
              { label: 'Exactitud', value: formatPercent(latestMetric?.accuracy), tone: '', hint: 'entrenamiento' },
              { label: 'Pérdida val.', value: formatMetric(latestMetric?.valLoss), tone: 'muted', hint: 'validación' },
              { label: 'Exactitud val.', value: formatPercent(latestMetric?.valAccuracy), tone: 'muted', hint: 'validación' },
              { label: 'Velocidad', value: formatSeconds(timing.secondsPerEpoch), tone: 'muted', hint: 'por época' },
              { label: 'Tiempo restante', value: formatSeconds(timing.etaSeconds), tone: 'muted', hint: isActive ? 'estimado' : 'sin ejecución' },
            ].map((item) => (
              <div key={item.label} className="glass-card p-4 rounded-2xl">
                <span className="text-xs text-zinc-600 dark:text-white/65 font-medium">
                  {item.label}
                </span>
                <div
                  className={`text-xl font-bold font-mono mt-1 ${
                    item.tone === 'muted'
                      ? 'text-zinc-700 dark:text-white/80'
                      : 'text-zinc-900 dark:text-white'
                  }`}
                >
                  {item.value}
                </div>
                <span className="text-2xs text-zinc-500 dark:text-white/60">{item.hint}</span>
              </div>
            ))}
          </div>

          {/* Start form */}
          <div className="glass-card p-5 rounded-2xl space-y-4">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-zinc-900 dark:text-white/90 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-zinc-600 dark:text-white/70" /> Configuración del
                nuevo trabajo
              </span>
              <span className="text-xs text-zinc-500 dark:text-white/65 font-mono">
                Semilla determinista · partición 70/15/15
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <label
                  htmlFor="training-architecture"
                  className="block text-zinc-700 dark:text-white/75 text-xs uppercase font-bold mb-1.5"
                >
                  Arquitectura
                </label>
                <select
                  id="training-architecture"
                  value={architectureId}
                  onChange={(event) => handleArchitectureChange(event.target.value)}
                  className="w-full glass-input rounded-xl px-3 py-2"
                >
                  <option value="">Seleccione…</option>
                  {architectures.map((architecture) => (
                    <option key={architecture.id} value={architecture.id}>
                      {architecture.name} · {labelFor(FAMILY_LABELS, architecture.family)} · v{architecture.version}
                    </option>
                  ))}
                </select>
                {architectures.length === 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                    Guarde una arquitectura en el Diseñador para poder entrenar.
                  </p>
                )}
                <p className="text-xs text-zinc-600 dark:text-white/65 mt-1">
                  La capa de salida se ajusta automáticamente a la tarea detectada
                  (por ejemplo, 1 unidad sigmoide en clasificación binaria).
                </p>
              </div>

              <div>
                <label
                  htmlFor="training-dataset"
                  className="block text-zinc-700 dark:text-white/75 text-xs uppercase font-bold mb-1.5"
                >
                  Conjunto de datos
                </label>
                <select
                  id="training-dataset"
                  value={datasetId}
                  onChange={(event) => handleDatasetChange(event.target.value)}
                  className="w-full glass-input rounded-xl px-3 py-2"
                >
                  <option value="">Seleccione…</option>
                  {datasets.map((dataset) => (
                    <option key={dataset.id} value={dataset.id}>
                      {dataset.name} · {dataset.metadata.samples} filas
                    </option>
                  ))}
                </select>
                {datasets.length === 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                    Suba un CSV validado en el módulo Conjuntos de datos.
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="training-target"
                  className="block text-zinc-700 dark:text-white/75 text-xs uppercase font-bold mb-1.5"
                >
                  Columna objetivo
                </label>
                <select
                  id="training-target"
                  value={targetColumn}
                  onChange={(event) => setTargetColumn(event.target.value)}
                  className="w-full glass-input rounded-xl px-3 py-2"
                  disabled={!selectedDataset}
                >
                  <option value="">Seleccione…</option>
                  {(selectedDataset?.metadata.columns || []).map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name} · {column.dtype}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="training-task"
                  className="block text-zinc-700 dark:text-white/75 text-xs uppercase font-bold mb-1.5"
                >
                  Tipo de tarea
                </label>
                <select
                  id="training-task"
                  value={task}
                  onChange={(event) =>
                    setTask(event.target.value as 'classification' | 'regression' | '')
                  }
                  className="w-full glass-input rounded-xl px-3 py-2"
                >
                  <option value="">Detectar desde el conjunto de datos</option>
                  <option value="classification">Clasificación</option>
                  <option value="regression">Regresión</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="training-epochs"
                  className="block text-zinc-700 dark:text-white/75 text-xs uppercase font-bold mb-1.5"
                >
                  Épocas
                </label>
                <input
                  id="training-epochs"
                  type="number"
                  min="1"
                  max="1000"
                  value={epochs}
                  onChange={(event) => setEpochs(Math.max(1, parseInt(event.target.value, 10) || 1))}
                  className="w-full glass-input rounded-xl px-3 py-2 font-mono"
                />
              </div>

              <div>
                <label
                  htmlFor="training-batch"
                  className="block text-zinc-700 dark:text-white/75 text-xs uppercase font-bold mb-1.5"
                >
                  Tamaño de lote
                </label>
                <select
                  id="training-batch"
                  value={batchSize}
                  onChange={(event) => setBatchSize(parseInt(event.target.value, 10))}
                  className="w-full glass-input rounded-xl px-3 py-2"
                >
                  {[8, 16, 32, 64, 128, 256].map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="training-optimizer"
                  className="block text-zinc-700 dark:text-white/75 text-xs uppercase font-bold mb-1.5"
                >
                  Optimizador
                </label>
                <select
                  id="training-optimizer"
                  value={optimizer}
                  onChange={(event) =>
                    setOptimizer(event.target.value as 'adam' | 'sgd' | 'rmsprop' | 'adamw' | 'nadam')
                  }
                  className="w-full glass-input rounded-xl px-3 py-2"
                >
                  <option value="adam">Adam</option>
                  <option value="adamw">AdamW</option>
                  <option value="nadam">Nadam</option>
                  <option value="sgd">SGD</option>
                  <option value="rmsprop">RMSprop</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="training-learning-rate"
                  className="block text-zinc-700 dark:text-white/75 text-xs uppercase font-bold mb-1.5"
                >
                  Tasa de aprendizaje
                </label>
                <input
                  id="training-learning-rate"
                  type="number"
                  step="0.0001"
                  min="0.000001"
                  max="1"
                  value={learningRate}
                  onChange={(event) =>
                    setLearningRate(Math.max(0.000001, parseFloat(event.target.value) || 0.001))
                  }
                  className="w-full glass-input rounded-xl px-3 py-2 font-mono"
                />
              </div>
            </div>

            {formError && (
              <div
                role="alert"
                aria-live="assertive"
                className="p-3 rounded-xl glass-inset border border-rose-500/30 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2"
              >
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {formError}
              </div>
            )}

            <p className="text-xs text-zinc-500 dark:text-white/65">
              {isActive
                ? `Hay un trabajo ${labelFor(JOB_STATUS_LABELS, effectiveStatus)}; puede encolar otro y el worker los procesará en orden.`
                : 'El trabajo se encola y lo procesa el worker aislado de TensorFlow.'}
            </p>
          </div>

          {/* Jobs table */}
          <div className="glass-card p-5 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-zinc-900 dark:text-white/90 flex items-center gap-1.5 uppercase tracking-wider">
                <Activity className="w-3.5 h-3.5 text-zinc-600 dark:text-white/70" /> Historial de
                trabajos
              </h2>
              <span className="text-xs text-zinc-500 dark:text-white/65 font-mono">
                {jobs.length} registrados
              </span>
            </div>

            {jobs.length === 0 && !loading ? (
              <EmptyBlock
                title="Sin trabajos de entrenamiento"
                description="Configure arquitectura, conjunto de datos e hiperparámetros para encolar el primer trabajo."
                icon={PlayCircle}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-black/10 dark:border-white/10 text-zinc-500 dark:text-white/65">
                      <th className="pb-2.5 font-medium">Trabajo</th>
                      <th className="pb-2.5 font-medium">Arquitectura</th>
                      <th className="pb-2.5 font-medium">Conjunto de datos</th>
                      <th className="pb-2.5 font-medium">Estado</th>
                      <th className="pb-2.5 font-medium">Épocas</th>
                      <th className="pb-2.5 font-medium">Creado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/5 dark:divide-white/5">
                    {jobs.map((job) => {
                      const architecture = architectures.find((item) => item.id === job.architectureId);
                      const dataset = datasets.find((item) => item.id === job.datasetId);
                      const isSelected = job.id === selectedJobId;
                      return (
                        <tr
                          key={job.id}
                          onClick={() => setSelectedJobId(job.id)}
                          className={`cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-black/5 dark:bg-white/10'
                              : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.04]'
                          }`}
                        >
                          <td className="py-2.5 font-mono text-zinc-700 dark:text-white/80">
                            {shortId(job.id)}
                          </td>
                          <td className="py-2.5 text-zinc-700 dark:text-white/70 max-w-[160px] truncate">
                            {architecture?.name || shortId(job.architectureId)}
                          </td>
                          <td className="py-2.5 text-zinc-600 dark:text-white/60 max-w-[150px] truncate">
                            {dataset?.name || shortId(job.datasetId)}
                          </td>
                          <td className="py-2.5">
                            <StatusPill status={job.status} />
                          </td>
                          <td className="py-2.5 font-mono text-zinc-600 dark:text-white/60">
                            {job.metrics.length}/{job.hyperparameters.epochs}
                          </td>
                          <td className="py-2.5 text-xs text-zinc-500 dark:text-white/65 font-mono whitespace-nowrap">
                            {formatDateTime(job.createdAt)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Console */}
          <div className="glass-card p-5 rounded-2xl space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-zinc-900 dark:text-white/90 flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-zinc-600 dark:text-white/60" /> Salida del
                worker (datos persistidos + SSE)
              </span>
              <span className="text-xs text-zinc-500 dark:text-white/65 font-mono">
                {telemetry.isConnected ? 'stream conectado' : 'sincronización por sondeo'}
              </span>
            </div>
            <div className="p-3.5 rounded-2xl bg-zinc-950 text-zinc-200 border border-black/10 dark:border-white/10 font-mono text-xs max-h-40 overflow-y-auto space-y-1">
              {logs.length === 0 ? (
                <div className="text-zinc-500">Seleccione un trabajo para ver su traza.</div>
              ) : (
                logs.map((log, index) => (
                  <div key={index} className="leading-tight">
                    <span className="text-zinc-500 mr-2">&gt;</span>
                    <span className={log.includes('exactitud=') ? 'text-emerald-400' : 'text-zinc-300'}>
                      {log}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right dock */}
        <div className="space-y-3.5">
          <div className="text-xs font-medium text-zinc-600 dark:text-white/65 flex items-center justify-between px-1">
            <span>Telemetría gráfica</span>
            <span className="text-xs text-zinc-800 dark:text-white/70">Clic para ampliar</span>
          </div>

          <button
            type="button"
            onClick={() => setEnlargedModal('loss')}
            className="glass-card p-4 rounded-2xl glass-card-hover cursor-pointer space-y-2 w-full text-left"
            aria-label="Ampliar curva de pérdida"
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-zinc-900 dark:text-white/90 flex items-center gap-1.5">
                <TrendingDown className="w-3.5 h-3.5 text-zinc-600 dark:text-white/70" /> Curva de
                pérdida
              </span>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-xs text-zinc-900 dark:text-white font-medium">
                  {formatMetric(latestMetric?.loss)}
                </span>
                <Maximize2 className="w-3 h-3 text-zinc-500 dark:text-white/65" />
              </div>
            </div>
            <div className="p-2 glass-inset rounded-xl">
              <MetricChart metrics={metrics} metric="loss" totalEpochs={totalEpochs} />
            </div>
            <div className="flex flex-wrap justify-between items-center gap-2 text-xs px-0.5">
              <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-zinc-600 dark:text-white/65">
                <span className="flex items-center gap-1 font-mono">
                  <span className="w-3 h-0.5 bg-sky-400 inline-block rounded-full" /> Entren.
                </span>
                <span className="flex items-center gap-1 font-mono">
                  <span className="w-3 h-0 inline-block border-t-2 border-dashed border-amber-400" /> Valid.
                </span>
                {bestLossEpoch != null && (
                  <span className="flex items-center gap-1 font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" /> Mejor: {bestLossEpoch}
                  </span>
                )}
              </span>
              <span className="text-sky-700 dark:text-sky-300 font-medium">Ampliar →</span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => hasAccuracy && setEnlargedModal('accuracy')}
            disabled={!hasAccuracy}
            className={`glass-card p-4 rounded-2xl space-y-2 w-full text-left ${
              hasAccuracy ? 'glass-card-hover cursor-pointer' : 'opacity-70'
            }`}
            aria-label="Ampliar curva de exactitud"
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-zinc-900 dark:text-white/90 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-zinc-600 dark:text-white/70" /> Curva de
                exactitud
              </span>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-xs text-zinc-900 dark:text-white font-medium">
                  {formatPercent(latestMetric?.accuracy)}
                </span>
                {hasAccuracy && <Maximize2 className="w-3 h-3 text-zinc-500 dark:text-white/65" />}
              </div>
            </div>
            <div className="p-2 glass-inset rounded-xl">
              {hasAccuracy ? (
                <MetricChart metrics={metrics} metric="accuracy" totalEpochs={totalEpochs} />
              ) : (
                <div className="h-28 flex items-center justify-center text-xs text-zinc-600 dark:text-white/65 font-mono">
                  No aplica para regresión
                </div>
              )}
            </div>
            <div className="flex flex-wrap justify-between items-center gap-2 text-xs px-0.5">
              <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-zinc-600 dark:text-white/65">
                <span className="flex items-center gap-1 font-mono">
                  <span className="w-3 h-0.5 bg-sky-400 inline-block rounded-full" /> Entren.
                </span>
                <span className="flex items-center gap-1 font-mono">
                  <span className="w-3 h-0 inline-block border-t-2 border-dashed border-amber-400" /> Valid.
                </span>
                {bestAccuracyEpoch != null && (
                  <span className="flex items-center gap-1 font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" /> Mejor: {bestAccuracyEpoch}
                  </span>
                )}
              </span>
              <span className="text-sky-700 dark:text-sky-300 font-medium">
                {hasAccuracy ? 'Ampliar →' : '—'}
              </span>
            </div>
          </button>

          <div className="glass-card p-4 rounded-2xl text-xs space-y-2 text-zinc-600 dark:text-white/60">
            <span className="font-semibold text-zinc-900 dark:text-white/90 block border-b border-black/10 dark:border-white/10 pb-1.5">
              Contexto del trabajo
            </span>
            <div className="flex justify-between gap-2">
              <span className="flex items-center gap-1 shrink-0">
                <Cpu className="w-3 h-3" /> Arquitectura
              </span>
              <span className="font-medium text-zinc-900 dark:text-white truncate max-w-[150px]">
                {selectedArchitecture?.name || (selectedJob ? shortId(selectedJob.architectureId) : '—')}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="flex items-center gap-1 shrink-0">
                <Database className="w-3 h-3" /> Conjunto de datos
              </span>
              <span className="font-medium text-zinc-900 dark:text-white truncate max-w-[150px]">
                {selectedDataset?.name || (selectedJob ? shortId(selectedJob.datasetId) : '—')}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="flex items-center gap-1 shrink-0">
                <FolderGit2 className="w-3 h-3" /> Proyecto
              </span>
              <span className="font-medium text-zinc-900 dark:text-white truncate max-w-[150px]">
                {activeProject.name}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Épocas configuradas</span>
              <span className="font-mono font-medium text-zinc-900 dark:text-white">
                {totalEpochs || '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Optimizador</span>
              <span className="font-mono font-medium text-zinc-900 dark:text-white">
                {selectedJob?.hyperparameters.optimizer || '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Tasa de aprendizaje</span>
              <span className="font-mono font-medium text-zinc-900 dark:text-white">
                {selectedJob?.hyperparameters.learningRate ?? '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Tamaño de lote</span>
              <span className="font-mono font-medium text-zinc-900 dark:text-white">
                {selectedJob?.hyperparameters.batchSize ?? '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Última lectura</span>
              <span className="font-mono text-xs text-zinc-700 dark:text-white/70 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {telemetry.lastEventAt
                  ? new Date(telemetry.lastEventAt).toLocaleTimeString()
                  : '—'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <EnlargedChartModal
        isOpen={enlargedModal !== null}
        onClose={() => setEnlargedModal(null)}
        title={
          enlargedModal === 'loss'
            ? 'Curva de pérdida (convergencia)'
            : 'Curva de exactitud (progreso)'
        }
        subtitle={
          enlargedModal === 'loss'
            ? 'Valores reales persistidos por época en entrenamiento y validación'
            : 'Evolución real de la exactitud sobre el conjunto de entrenamiento y validación'
        }
        badge={selectedJob ? `Trabajo: ${shortId(selectedJob.id)}` : 'Sin trabajo'}
      >
        <div className="space-y-4">
          <div className="p-4 glass-inset rounded-2xl border border-black/10 dark:border-white/10">
            {enlargedModal && (
              <MetricChart
                metrics={metrics}
                metric={enlargedModal}
                totalEpochs={totalEpochs}
                isLarge
              />
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3.5 rounded-2xl glass-inset border border-black/10 dark:border-white/10">
              <span className="text-zinc-500 dark:text-white/65 text-xs uppercase font-bold tracking-wider">
                Época actual
              </span>
              <div className="text-base font-bold font-mono text-zinc-900 dark:text-white mt-1">
                {telemetry.currentEpoch} / {totalEpochs || '—'}
              </div>
            </div>
            <div className="p-3.5 rounded-2xl glass-inset border border-black/10 dark:border-white/10">
              <span className="text-zinc-500 dark:text-white/65 text-xs uppercase font-bold tracking-wider">
                Último entrenamiento
              </span>
              <div className="text-base font-bold font-mono text-zinc-900 dark:text-white mt-1">
                {enlargedModal === 'loss'
                  ? formatMetric(latestMetric?.loss)
                  : formatPercent(latestMetric?.accuracy)}
              </div>
            </div>
            <div className="p-3.5 rounded-2xl glass-inset border border-black/10 dark:border-white/10">
              <span className="text-zinc-500 dark:text-white/65 text-xs uppercase font-bold tracking-wider">
                Última validación
              </span>
              <div className="text-base font-bold font-mono text-zinc-700 dark:text-white/80 mt-1">
                {enlargedModal === 'loss'
                  ? formatMetric(latestMetric?.valLoss)
                  : formatPercent(latestMetric?.valAccuracy)}
              </div>
            </div>
            <div className="p-3.5 rounded-2xl glass-inset border border-black/10 dark:border-white/10">
              <span className="text-zinc-500 dark:text-white/65 text-xs uppercase font-bold tracking-wider">
                Estado
              </span>
              <div className="text-base font-bold font-mono text-zinc-900 dark:text-white mt-1">
                {effectiveStatus ? labelFor(JOB_STATUS_LABELS, effectiveStatus) : '—'}
              </div>
            </div>
          </div>
        </div>
      </EnlargedChartModal>
    </div>
  );
};
