import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Download,
  Copy,
  Check,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  Loader2,
  FileCheck2,
  FileText,
  FlaskConical,
  ArrowRight,
  Lock,
  X,
  FileSpreadsheet,
  Code2,
  Terminal,
  UploadCloud,
  CheckCircle2,
} from 'lucide-react';
import { useApp } from '../../lib/AppContext';
import { ApiClient } from '../../lib/api';
import {
  LoadingBlock,
  ErrorBlock,
  EmptyBlock,
  ProjectRequired,
} from '../../components/common/ProjectGuard';
import { formatDateTime, formatMetric, formatPercent, shortId } from '../../lib/format';
import { MODEL_STATUS_LABELS } from '../../lib/labels';
import {
  ModelInputField,
  ModelLifecycleStatus,
  ModelMetrics,
  ModelVersion,
  PredictionResult,
  UserRole,
} from '../../types';

const APPROVAL_ROLES: string[] = ['ADMIN', 'PROJECT_LEAD'];

// Transiciones aceptadas por el backend (app/api/v1/models.py).
const TRANSITIONS: Record<ModelLifecycleStatus, ModelLifecycleStatus[]> = {
  DRAFT: ['REVIEWED', 'RETIRED'],
  REVIEWED: ['APPROVED', 'RETIRED'],
  APPROVED: ['RETIRED'],
  RETIRED: [],
};

const STATUS_STYLES: Record<ModelLifecycleStatus, string> = {
  DRAFT: 'text-zinc-700 dark:text-white/80 border-black/20 dark:border-white/25',
  REVIEWED: 'text-sky-700 dark:text-sky-300 border-sky-500/30',
  APPROVED: 'text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  RETIRED: 'text-zinc-500 dark:text-white/65 border-black/10 dark:border-white/10',
};

function lifecycleActions(
  status: ModelLifecycleStatus,
  effectiveRole: UserRole | string,
): { target: ModelLifecycleStatus; label: string; requiresApproval: boolean; allowed: boolean }[] {
  return TRANSITIONS[status].map((target) => {
    const requiresApproval = target === 'APPROVED' || target === 'RETIRED';
    const allowed = !requiresApproval || APPROVAL_ROLES.includes(String(effectiveRole));
    return { target, label: MODEL_STATUS_LABELS[target], requiresApproval, allowed };
  });
}

function metricHighlights(metrics: ModelMetrics | null): { label: string; value: string }[] {
  if (!metrics) return [];
  const accuracy = metrics.testAccuracy ?? metrics.accuracy;
  const loss = metrics.testLoss ?? metrics.loss;
  const highlights: { label: string; value: string }[] = [];
  if (accuracy != null) highlights.push({ label: 'Exactitud', value: formatPercent(accuracy) });
  if (loss != null) highlights.push({ label: 'Pérdida', value: formatMetric(loss) });
  if (metrics.f1Score != null) highlights.push({ label: 'F1-Score', value: formatMetric(metrics.f1Score) });
  if (metrics.rocAuc != null) highlights.push({ label: 'ROC-AUC', value: formatMetric(metrics.rocAuc) });
  if (metrics.r2Score != null) highlights.push({ label: 'R²', value: formatMetric(metrics.r2Score) });
  if (metrics.testRmse != null) highlights.push({ label: 'RMSE', value: formatMetric(metrics.testRmse) });
  return highlights.slice(0, 4);
}

export const ModelRegistryView: React.FC = () => {
  const { activeProject, showToast, currentRole } = useApp();

  const [models, setModels] = useState<ModelVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [cardLoadingId, setCardLoadingId] = useState<string | null>(null);
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | ModelLifecycleStatus>('ALL');

  const effectiveRole = (activeProject?.effectiveRole as UserRole | string) || currentRole;

  const loadModels = useCallback(
    async (silent = false) => {
      if (!activeProject) return;
      if (!silent) setLoading(true);
      try {
        const list = await ApiClient.listModels(activeProject.id);
        setModels(list);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No fue posible cargar el registro de modelos');
      } finally {
        setLoading(false);
      }
    },
    [activeProject],
  );

  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadModels(true);
    setRefreshing(false);
  };

  const handleStatusChange = async (model: ModelVersion, target: ModelLifecycleStatus) => {
    const transition = lifecycleActions(model.status, effectiveRole).find((item) => item.target === target);
    if (!transition) {
      showToast(`Transición no permitida: ${MODEL_STATUS_LABELS[model.status]} → ${MODEL_STATUS_LABELS[target]}`, 'warning');
      return;
    }
    if (!transition.allowed) {
      showToast(
        `Permiso denegado: se requiere rol ADMIN o PROJECT_LEAD para pasar a ${target} (RBAC)`,
        'warning',
      );
      return;
    }
    setUpdatingId(model.id);
    try {
      const updated = await ApiClient.updateModelStatus(model.id, target);
      setModels((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      showToast(`Versión ${model.version}: ${MODEL_STATUS_LABELS[model.status]} → ${MODEL_STATUS_LABELS[target]}`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No fue posible actualizar el estado', 'error');
    } finally {
      setUpdatingId(null);
    }
  };

  const copyChecksum = async (checksum: string, id: string) => {
    try {
      await navigator.clipboard.writeText(checksum);
      setCopiedId(id);
      showToast('Hash SHA-256 copiado al portapapeles', 'info');
      setTimeout(() => setCopiedId(null), 2500);
    } catch {
      showToast('No fue posible acceder al portapapeles del navegador', 'error');
    }
  };

  const handleDownload = async (model: ModelVersion) => {
    setDownloadingId(model.id);
    try {
      const { blob, filename } = await ApiClient.downloadModel(model.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename || `model_${model.version}.keras`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast(`Artefacto ${filename} descargado`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No fue posible descargar el artefacto', 'error');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleOpenCard = async (model: ModelVersion) => {
    setCardLoadingId(model.id);
    try {
      const markdown = await ApiClient.getModelCard(model.id);
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      showToast(`Ficha de la versión ${model.version} abierta`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'La ficha del modelo no está disponible', 'error');
    } finally {
      setCardLoadingId(null);
    }
  };

  const counts = useMemo(() => {
    const base: Record<string, number> = { ALL: models.length };
    models.forEach((model) => {
      base[model.status] = (base[model.status] || 0) + 1;
    });
    return base;
  }, [models]);

  const filteredModels = useMemo(
    () => (statusFilter === 'ALL' ? models : models.filter((model) => model.status === statusFilter)),
    [models, statusFilter],
  );

  if (!activeProject) {
    return (
      <div className="space-y-4 animate-in fade-in duration-200">
        <RegistryHeader onRefresh={handleRefresh} refreshing={refreshing} disabled />
        <ProjectRequired action="Seleccione un proyecto para consultar sus versiones de modelo inmutables." />
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-black/10 dark:border-white/10">
        <div>
          <div className="flex items-center gap-2 text-zinc-600 dark:text-white/60 text-xs font-semibold uppercase tracking-wider">
            <Box className="w-4 h-4 text-zinc-700 dark:text-white/80" /> Módulo 08 • Registro de Modelos
          </div>
          <h1 className="text-xl sm:text-2xl font-semibold text-zinc-900 dark:text-white mt-1">
            Gobernanza de Modelos &amp; Versionado Inmutable
          </h1>
          <p className="text-xs text-zinc-500 dark:text-white/65 mt-0.5">
            Ciclo de vida DRAFT → REVIEWED → APPROVED → RETIRED con integridad criptográfica SHA-256.
            Proyecto activo: <strong className="text-zinc-700 dark:text-white/70">{activeProject.name}</strong>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 dark:text-white/65">
            Rol efectivo: <strong className="font-mono text-zinc-800 dark:text-white/80">{effectiveRole}</strong>
          </span>
          <button
            onClick={handleRefresh}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl glass-btn-secondary text-xs font-medium"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Actualizar
          </button>
        </div>
      </div>

      <div className="glass-card p-3 rounded-2xl flex flex-wrap items-center gap-2 text-xs">
        <span className="text-zinc-500 dark:text-white/65 font-medium px-1">Filtrar:</span>
        {(['ALL', 'DRAFT', 'REVIEWED', 'APPROVED', 'RETIRED'] as const).map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`px-2.5 py-1 rounded-lg transition-all font-mono text-xs ${
              statusFilter === status
                ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-950 font-semibold'
                : 'text-zinc-600 dark:text-white/60 hover:text-zinc-900 dark:hover:text-white'
            }`}
          >
            {status === 'ALL' ? 'TODOS' : status} ({counts[status] || 0})
          </button>
        ))}
      </div>

      {loading && <LoadingBlock label="Cargando versiones de modelo…" />}

      {!loading && error && <ErrorBlock message={error} onRetry={() => loadModels()} />}

      {!loading && !error && filteredModels.length === 0 && (
        <EmptyBlock
          icon={Box}
          title={models.length === 0 ? 'Aún no hay versiones registradas' : 'Sin modelos para este estado'}
          description={
            models.length === 0
              ? 'Complete un entrenamiento exitoso en el módulo Entrenamientos. El worker creará automáticamente una versión inmutable con su checksum.'
              : 'Cambie el filtro para consultar otras versiones del registro.'
          }
        />
      )}

      <div className="space-y-3.5">
        {filteredModels.map((model) => {
          const highlights = metricHighlights(model.metricsSummary);
          const actions = lifecycleActions(model.status, effectiveRole);
          const task = model.metricsSummary?.task;
          return (
            <div key={model.id} className="glass-card p-5 rounded-2xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl glass-inset text-zinc-900 dark:text-white flex items-center justify-center font-bold border border-black/10 dark:border-white/10 shrink-0">
                    <Box className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-white font-mono">
                        {model.version}
                      </h3>
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full glass-inset border ${STATUS_STYLES[model.status]}`}
                      >
                        {model.status === 'APPROVED' && <ShieldCheck className="w-3 h-3" />}
                        {model.status}
                      </span>
                      {task && (
                        <span className="text-xs font-mono px-2 py-0.5 rounded-full glass-inset border border-black/10 dark:border-white/10 text-zinc-600 dark:text-white/60">
                          {task}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-white/65 font-mono mt-1 truncate">
                      {model.storageKey}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-white/65 mt-0.5">
                      Registrado {formatDateTime(model.createdAt)} · Job{' '}
                      <span className="font-mono">{shortId(model.jobId, 12)}</span>
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {actions.map((action) => (
                    <button
                      key={action.target}
                      onClick={() => handleStatusChange(model, action.target)}
                      disabled={updatingId === model.id}
                      title={
                        action.allowed
                          ? `Mover a ${MODEL_STATUS_LABELS[action.target]}`
                          : `Requiere rol ADMIN o PROJECT_LEAD (RBAC)`
                      }
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium ${
                        action.allowed
                          ? 'glass-btn-secondary'
                          : 'glass-btn-secondary opacity-45 cursor-not-allowed'
                      } ${action.target === 'RETIRED' ? 'text-amber-700 dark:text-amber-300' : ''}`}
                    >
                      {!action.allowed && <Lock className="w-3 h-3" />}
                      {updatingId === model.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRight className="w-3 h-3" />}
                      {action.label}
                    </button>
                  ))}

                  <button
                    onClick={() => handleOpenCard(model)}
                    disabled={cardLoadingId === model.id || model.status === 'RETIRED'}
                    title="Ver la ficha del modelo generada en el entrenamiento"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl glass-btn-secondary text-xs font-medium disabled:opacity-50"
                  >
                    {cardLoadingId === model.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <FileText className="w-3.5 h-3.5" />
                    )}
                    Ficha
                  </button>

                  <button
                    onClick={() => setTestingModelId(testingModelId === model.id ? null : model.id)}
                    disabled={model.status === 'RETIRED' || !model.metricsSummary?.inputSchema?.length}
                    title={
                      !model.metricsSummary?.inputSchema?.length
                        ? 'Reentrene el modelo para generar el esquema de entrada'
                        : 'Ejecutar una predicción real contra el modelo servido'
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl glass-btn-secondary text-xs font-medium disabled:opacity-50"
                  >
                    <FlaskConical className="w-3.5 h-3.5" />
                    {testingModelId === model.id ? 'Cerrar prueba' : 'Probar modelo'}
                  </button>

                  <button
                    onClick={() => handleDownload(model)}
                    disabled={downloadingId === model.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl glass-btn-primary text-xs font-semibold disabled:opacity-50"
                  >
                    {downloadingId === model.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                    Descargar .keras
                  </button>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl glass-inset border border-black/10 dark:border-white/10 text-xs">
                <div className="flex items-center gap-2 overflow-hidden min-w-0">
                  <FileCheck2 className="w-3.5 h-3.5 text-zinc-500 dark:text-white/65 shrink-0" />
                  <span className="text-xs uppercase font-bold text-zinc-500 dark:text-white/65 tracking-wider shrink-0">
                    SHA-256
                  </span>
                  <code className="font-mono text-xs text-zinc-800 dark:text-white/80 truncate">
                    {model.checksum}
                  </code>
                </div>
                <button
                  onClick={() => copyChecksum(model.checksum, model.id)}
                  className="flex items-center gap-1 text-xs text-zinc-600 dark:text-white/70 hover:text-zinc-900 dark:hover:text-white shrink-0 self-end sm:self-auto font-medium"
                >
                  {copiedId === model.id ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> Copiado
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" /> Copiar Hash
                    </>
                  )}
                </button>
              </div>

              {highlights.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  {highlights.map((item) => (
                    <div key={item.label} className="p-2.5 glass-inset rounded-xl">
                      <span className="text-zinc-500 dark:text-white/65 text-xs uppercase font-bold">
                        {item.label}
                      </span>
                      <p className="font-mono font-semibold text-zinc-900 dark:text-white mt-0.5">
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-zinc-500 dark:text-white/65 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" /> Esta versión no tiene métricas de evaluación persistidas.
                </p>
              )}

              {model.metricsSummary?.datasetVersion && (
                <p className="text-xs text-zinc-500 dark:text-white/65 font-mono">
                  Conjunto de datos {model.metricsSummary.datasetVersion}
                  {model.metricsSummary.datasetChecksum
                    ? ` · checksum ${model.metricsSummary.datasetChecksum.slice(0, 16)}…`
                    : ''}
                </p>
              )}

              {testingModelId === model.id && (
                <PredictionPanel model={model} onClose={() => setTestingModelId(null)} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const PredictionPanel: React.FC<{ model: ModelVersion; onClose: () => void }> = ({
  model,
  onClose,
}) => {
  const schema: ModelInputField[] = model.metricsSummary?.inputSchema || [];
  const classLabels = model.metricsSummary?.classLabels || [];
  const isBinary = model.metricsSummary?.task === 'classification' && classLabels.length === 2;

  const [activeTab, setActiveTab] = useState<'single' | 'batch' | 'code'>('single');

  // Estado para inferencia individual
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    schema.forEach((field) => {
      if (field.kind === 'numeric') {
        initial[field.name] = field.median != null ? String(field.median) : '';
      } else {
        initial[field.name] = field.values?.[0] ?? '';
      }
    });
    return initial;
  });
  const [threshold, setThreshold] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PredictionResult | null>(null);

  // Estado para inferencia por lotes (CSV)
  const [batchFile, setBatchFile] = useState<File | null>(null);
  const [batchRecords, setBatchRecords] = useState<Record<string, unknown>[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchResult, setBatchResult] = useState<PredictionResult | null>(null);

  // Estado para snippets de código
  const [codeLang, setCodeLang] = useState<'curl' | 'python' | 'javascript'>('curl');
  const [codeCopied, setCodeCopied] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const record: Record<string, unknown> = {};
      schema.forEach((field) => {
        const raw = values[field.name];
        if (field.kind === 'numeric') {
          record[field.name] = raw === '' ? null : Number(raw);
        } else {
          record[field.name] = raw;
        }
      });
      const parsedThreshold = threshold === '' ? undefined : Number(threshold);
      const response = await ApiClient.predictModel(model.id, [record], parsedThreshold);
      setResult(response);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : 'No fue posible ejecutar la predicción');
    } finally {
      setLoading(false);
    }
  };

  // Parser simple y robusto de CSV en navegador
  const handleCSVUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBatchFile(file);
    setBatchResult(null);
    setBatchError(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length < 2) {
          throw new Error('El archivo CSV debe contener encabezados y al menos una fila de datos');
        }

        const parseLine = (line: string): string[] => {
          const res: string[] = [];
          let cur = '';
          let inQ = false;
          for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
              inQ = !inQ;
            } else if (ch === ',' && !inQ) {
              res.push(cur.trim().replace(/^"|"$/g, ''));
              cur = '';
            } else {
              cur += ch;
            }
          }
          res.push(cur.trim().replace(/^"|"$/g, ''));
          return res;
        };

        const headers = parseLine(lines[0]);
        const records = lines.slice(1).map((line) => {
          const rowVals = parseLine(line);
          const row: Record<string, unknown> = {};
          headers.forEach((h, i) => {
            const v = rowVals[i];
            if (v === undefined || v === '') {
              row[h] = null;
            } else if (!isNaN(Number(v))) {
              row[h] = Number(v);
            } else {
              row[h] = v;
            }
          });
          return row;
        });

        setBatchRecords(records);
      } catch (err) {
        setBatchError(err instanceof Error ? err.message : 'Error al procesar el archivo CSV');
        setBatchRecords([]);
      }
    };
    reader.readAsText(file);
  };

  const handleRunBatch = async () => {
    if (!batchRecords.length) return;
    setBatchLoading(true);
    setBatchError(null);
    try {
      // Mandar hasta 1000 registros
      const recordsToSend = batchRecords.slice(0, 1000);
      const response = await ApiClient.predictModel(model.id, recordsToSend);
      setBatchResult(response);
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : 'Fallo en la inferencia por lotes');
    } finally {
      setBatchLoading(false);
    }
  };

  const handleDownloadEnrichedCSV = () => {
    if (!batchRecords.length || !batchResult) return;
    const headers = Object.keys(batchRecords[0]);
    const isRegression = batchResult.task === 'regression';
    const extraHeaders = isRegression ? ['valor_estimado'] : ['clase_predicha', 'probabilidad'];
    const allHeaders = [...headers, ...extraHeaders];

    const rows = batchRecords.slice(0, batchResult.predictions.length).map((rec, i) => {
      const pred = batchResult.predictions[i] || {};
      const extraVals = isRegression
        ? [pred.prediction != null ? String(pred.prediction) : '']
        : [
            pred.label ?? pred.prediction ?? '',
            pred.probability != null ? `${(pred.probability * 100).toFixed(2)}%` : '',
          ];
      const origVals = headers.map((h) => {
        const val = rec[h];
        return val == null ? '' : String(val).replace(/"/g, '""');
      });
      return [...origVals, ...extraVals].map((v) => `"${v}"`).join(',');
    });

    const csvContent = [allHeaders.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `predicciones_${batchFile?.name.replace(/\.[^/.]+$/, '') || 'lote'}_${model.version}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Muestra de datos para código
  const samplePayloadRecord = useMemo(() => {
    const rec: Record<string, unknown> = {};
    schema.forEach((f) => {
      if (f.kind === 'numeric') {
        rec[f.name] = f.median != null ? f.median : 0;
      } else {
        rec[f.name] = f.values?.[0] || 'categoria_ejemplo';
      }
    });
    return rec;
  }, [schema]);

  const apiBaseUrl = (import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1').replace(/\/$/, '');
  const endpointUrl = `${apiBaseUrl}/models/${model.id}/predict`;

  const getCodeSnippet = () => {
    const jsonStr = JSON.stringify({ records: [samplePayloadRecord] }, null, 2);
    if (codeLang === 'curl') {
      return `curl -X POST "${endpointUrl}" \\
  -H "Authorization: Bearer <TU_JWT_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '${jsonStr}'`;
    }
    if (codeLang === 'python') {
      return `import requests

url = "${endpointUrl}"
headers = {
    "Authorization": "Bearer <TU_JWT_TOKEN>",
    "Content-Type": "application/json"
}
payload = ${JSON.stringify({ records: [samplePayloadRecord] }, null, 4)}

response = requests.post(url, json=payload, headers=headers)
print("Código HTTP:", response.status_code)
print("Predicciones:", response.json())`;
    }
    return `// Node.js (v18+) o navegador
const response = await fetch("${endpointUrl}", {
  method: "POST",
  headers: {
    "Authorization": "Bearer <TU_JWT_TOKEN>",
    "Content-Type": "application/json"
  },
  body: JSON.stringify(${JSON.stringify({ records: [samplePayloadRecord] }, null, 2)})
});

const data = await response.json();
console.log("Resultado:", data.predictions);`;
  };

  const copyCode = () => {
    navigator.clipboard.writeText(getCodeSnippet());
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  return (
    <div className="rounded-2xl border border-sky-500/25 bg-sky-500/[0.04] p-4 space-y-4">
      {/* Cabecera del Panel */}
      <div className="flex items-start justify-between gap-3 border-b border-black/10 dark:border-white/10 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-sky-700 dark:text-sky-300 flex items-center gap-1.5">
              <FlaskConical className="w-3.5 h-3.5" /> Inferencia &amp; Consumo Empresarial ({model.version})
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-700 dark:text-sky-300 font-mono">
              {model.metricsSummary?.task || 'MLP'}
            </span>
          </div>
          <p className="text-xs text-zinc-600 dark:text-white/60 mt-0.5">
            Preprocesamiento idéntico al entrenamiento (escaler v2) con control de umbral y trazabilidad.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-900 dark:text-white/65 dark:hover:text-white p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5"
          aria-label="Cerrar panel de prueba"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Pestañas de Modo */}
      <div className="flex items-center gap-1.5 bg-black/5 dark:bg-white/5 p-1 rounded-xl">
        <button
          type="button"
          onClick={() => setActiveTab('single')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeTab === 'single'
              ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30 shadow-[0_0_12px_rgba(225,29,72,0.25)] font-semibold'
              : 'text-zinc-600 dark:text-white/60 hover:text-zinc-900 dark:hover:text-white'
          }`}
        >
          <FlaskConical className="w-3.5 h-3.5" /> Individual (Formulario)
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('batch')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeTab === 'batch'
              ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30 shadow-[0_0_12px_rgba(225,29,72,0.25)] font-semibold'
              : 'text-zinc-600 dark:text-white/60 hover:text-zinc-900 dark:hover:text-white'
          }`}
        >
          <FileSpreadsheet className="w-3.5 h-3.5" /> Lote CSV
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('code')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeTab === 'code'
              ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30 shadow-[0_0_12px_rgba(225,29,72,0.25)] font-semibold'
              : 'text-zinc-600 dark:text-white/60 hover:text-zinc-900 dark:hover:text-white'
          }`}
        >
          <Code2 className="w-3.5 h-3.5" /> Integración API (cURL / Python / JS)
        </button>
      </div>

      {/* 1. MODO INDIVIDUAL */}
      {activeTab === 'single' && (
        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {schema.map((field) => (
            <label key={field.name} className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-zinc-700 dark:text-white/70">
                {field.name}
                {field.nullable ? ' (opcional)' : ''}
              </span>
              {field.kind === 'numeric' ? (
                <input
                  type="number"
                  step="any"
                  min={field.min ?? undefined}
                  max={field.max ?? undefined}
                  value={values[field.name] ?? ''}
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, [field.name]: event.target.value }))
                  }
                  className="glass-inset rounded-lg border border-black/10 dark:border-white/10 px-2.5 py-1.5 font-mono text-xs text-zinc-900 dark:text-white bg-transparent"
                />
              ) : (field.values?.length ?? 0) > 0 && (field.values?.length ?? 0) <= 40 ? (
                <select
                  value={values[field.name] ?? ''}
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, [field.name]: event.target.value }))
                  }
                  className="glass-inset rounded-lg border border-black/10 dark:border-white/10 px-2.5 py-1.5 text-xs text-zinc-900 dark:text-white bg-transparent"
                >
                  {field.values?.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={values[field.name] ?? ''}
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, [field.name]: event.target.value }))
                  }
                  className="glass-inset rounded-lg border border-black/10 dark:border-white/10 px-2.5 py-1.5 text-xs text-zinc-900 dark:text-white bg-transparent"
                />
              )}
              {field.kind === 'numeric' && (field.min != null || field.max != null) && (
                <span className="text-xs text-zinc-500 dark:text-white/65 font-mono">
                  rango {formatMetric(field.min)} – {formatMetric(field.max)}
                </span>
              )}
            </label>
          ))}

          {isBinary && (
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-zinc-700 dark:text-white/70">
                Umbral de decisión (opcional)
              </span>
              <input
                type="number"
                step="0.01"
                min={0}
                max={1}
                placeholder={
                  model.metricsSummary?.decisionThreshold != null
                    ? String(model.metricsSummary.decisionThreshold)
                    : '0.5'
                }
                value={threshold}
                onChange={(event) => setThreshold(event.target.value)}
                className="glass-inset rounded-lg border border-black/10 dark:border-white/10 px-2.5 py-1.5 font-mono text-xs text-zinc-900 dark:text-white bg-transparent"
              />
              <span className="text-xs text-zinc-500 dark:text-white/65">
                Vacío = umbral óptimo calculado en la evaluación.
              </span>
            </label>
          )}

          <div className="sm:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl glass-btn-primary text-xs font-semibold disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
              Ejecutar predicción
            </button>
          </div>
        </form>
      )}

      {/* 2. MODO LOTE CSV */}
      {activeTab === 'batch' && (
        <div className="space-y-3">
          <div className="rounded-xl border border-dashed border-rose-500/30 bg-rose-500/[0.02] p-4 text-center">
            <UploadCloud className="w-8 h-8 mx-auto text-rose-500 drop-shadow-[0_0_8px_rgba(244,63,94,0.6)] mb-2" />
            <p className="text-xs font-semibold text-zinc-900 dark:text-white">
              Sube un archivo CSV para predecir en lote
            </p>
            <p className="text-xs text-zinc-500 dark:text-white/65 mt-0.5">
              El archivo debe contener las mismas columnas que el esquema del modelo.
            </p>
            <input
              type="file"
              accept=".csv"
              onChange={handleCSVUpload}
              className="mt-3 block w-full text-xs text-zinc-500 dark:text-white/65 file:mr-4 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:glass-btn-primary cursor-pointer"
            />
          </div>

          {batchFile && batchRecords.length > 0 && (
            <div className="rounded-xl glass-inset p-3 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium text-zinc-800 dark:text-white/80 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" /> {batchFile.name}
                </span>
                <span className="font-mono text-zinc-500 dark:text-white/65">
                  {batchRecords.length} registros detectados
                </span>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleRunBatch}
                  disabled={batchLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl glass-btn-primary text-xs font-semibold disabled:opacity-50"
                >
                  {batchLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FlaskConical className="w-3.5 h-3.5" />
                  )}
                  Procesar lote ({batchRecords.length} filas)
                </button>
              </div>
            </div>
          )}

          {batchError && (
            <p className="text-xs text-rose-700 dark:text-rose-300 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {batchError}
            </p>
          )}

          {batchResult && (
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    ¡Lote procesado exitosamente!
                  </p>
                  <p className="text-xs text-zinc-600 dark:text-white/60">
                    Se generaron {batchResult.predictions.length} predicciones con éxito.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadEnrichedCSV}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-all"
                >
                  <Download className="w-4 h-4" /> Descargar CSV con Resultados
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3. MODO INTEGRACIÓN API / CÓDIGO */}
      {activeTab === 'code' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 bg-black/5 dark:bg-white/5 p-1 rounded-lg">
              <button
                type="button"
                onClick={() => setCodeLang('curl')}
                className={`px-2.5 py-1 rounded-md text-xs font-mono transition-all ${
                  codeLang === 'curl'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                cURL
              </button>
              <button
                type="button"
                onClick={() => setCodeLang('python')}
                className={`px-2.5 py-1 rounded-md text-xs font-mono transition-all ${
                  codeLang === 'python'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                Python
              </button>
              <button
                type="button"
                onClick={() => setCodeLang('javascript')}
                className={`px-2.5 py-1 rounded-md text-xs font-mono transition-all ${
                  codeLang === 'javascript'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                Node.js / JS
              </button>
            </div>

            <button
              type="button"
              onClick={copyCode}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg glass-btn-secondary text-xs font-medium"
            >
              {codeCopied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-500" /> Copiado
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" /> Copiar código
                </>
              )}
            </button>
          </div>

          <div className="relative rounded-xl bg-zinc-950 p-3 font-mono text-xs text-zinc-100 overflow-x-auto border border-zinc-800 max-h-64">
            <pre>{getCodeSnippet()}</pre>
          </div>
          <p className="text-xs text-zinc-500 dark:text-white/65">
            Reemplaza <code className="font-mono text-sky-400">&lt;TU_JWT_TOKEN&gt;</code> con el token devuelto por <code className="font-mono">POST /auth/login</code>.
          </p>
        </div>
      )}

      {/* Resultados de inferencia individual */}
      {activeTab === 'single' && result && (
        <div className="rounded-xl glass-inset border border-black/10 dark:border-white/10 p-3 space-y-2">
          {result.predictions.map((item) => (
            <div key={item.index} className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-xs uppercase font-bold text-zinc-500 dark:text-white/65">
                  {result.task === 'regression' ? 'Valor estimado' : 'Clase predicha'}
                </span>
                <p className="font-mono font-semibold text-zinc-900 dark:text-white">
                  {item.label ?? item.prediction}
                </p>
              </div>
              {item.probability != null && (
                <div className="text-right">
                  <span className="text-xs uppercase font-bold text-zinc-500 dark:text-white/65">
                    Probabilidad
                  </span>
                  <p className="font-mono font-semibold text-zinc-900 dark:text-white">
                    {formatPercent(item.probability)}
                  </p>
                </div>
              )}
              {item.threshold != null && (
                <span className="text-xs font-mono text-zinc-500 dark:text-white/65">
                  umbral {formatMetric(item.threshold)}
                </span>
              )}
            </div>
          ))}

          {result.predictions[0]?.probabilities && (
            <div className="space-y-1">
              {Object.entries(result.predictions[0].probabilities)
                .sort(([, a], [, b]) => b - a)
                .map(([label, probability]) => (
                  <div key={label} className="flex items-center gap-2 text-xs">
                    <span className="w-24 truncate font-mono text-zinc-600 dark:text-white/60">
                      {label}
                    </span>
                    <div className="flex-1 h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                      <div
                        className="h-full bg-sky-500"
                        style={{ width: `${Math.min(100, probability * 100)}%` }}
                      />
                    </div>
                    <span className="w-14 text-right font-mono text-zinc-700 dark:text-white/70">
                      {formatPercent(probability)}
                    </span>
                  </div>
                ))}
            </div>
          )}

          {result.warnings.length > 0 && (
            <ul className="text-xs text-amber-700 dark:text-amber-300 space-y-0.5">
              {result.warnings.map((warning) => (
                <li key={warning} className="flex items-start gap-1">
                  <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" /> {warning}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

const RegistryHeader: React.FC<{ onRefresh: () => void; refreshing: boolean; disabled?: boolean }> = ({
  onRefresh,
  refreshing,
  disabled,
}) => (
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-black/10 dark:border-white/10">
    <div>
      <div className="flex items-center gap-2 text-zinc-600 dark:text-white/60 text-xs font-semibold uppercase tracking-wider">
        <Box className="w-4 h-4 text-zinc-700 dark:text-white/80" /> Módulo 08 • Registro de Modelos
      </div>
      <h1 className="text-xl sm:text-2xl font-semibold text-zinc-900 dark:text-white mt-1">
        Gobernanza de Modelos &amp; Versionado Inmutable
      </h1>
    </div>
    <button
      onClick={onRefresh}
      disabled={disabled}
      className="flex items-center gap-1.5 px-3 py-2 rounded-xl glass-btn-secondary text-xs font-medium disabled:opacity-40"
    >
      <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Actualizar
    </button>
  </div>
);
