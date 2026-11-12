import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FileSpreadsheet,
  Download,
  Printer,
  ShieldCheck,
  Layers,
  FileCheck2,
  RefreshCw,
  AlertTriangle,
  Loader2,
  Box,
  Database,
  PlayCircle,
  Activity,
} from 'lucide-react';
import { useApp } from '../../lib/AppContext';
import { useAuth } from '../../lib/AuthContext';
import { ApiClient } from '../../lib/api';
import {
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  ProjectRequired,
} from '../../components/common/ProjectGuard';
import { formatDateTime, formatMetric, formatNumber, formatPercent, shortId } from '../../lib/format';
import {
  Architecture,
  ArchitectureValidationResult,
  AuditEvent,
  Dataset,
  ModelVersion,
  TrainingJob,
} from '../../types';

function csvEscape(value: unknown): string {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function safeFilename(value: string): string {
  return value.replace(/[^a-z0-9-_]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'reporte';
}

function metricEntries(
  model: ModelVersion | null,
  dataset: Dataset | null,
): { label: string; value: string; raw: number | string }[] {
  const metrics = model?.metricsSummary;
  if (!metrics) return [];
  const task = metrics.task || dataset?.metadata.task;
  const entries: { label: string; value: string; raw: number | string }[] = [];
  const push = (label: string, value: number | undefined, formatter: (v: number) => string) => {
    if (value == null || Number.isNaN(value)) return;
    entries.push({ label, value: formatter(value), raw: value });
  };

  if (task === 'regression' || metrics.r2Score != null || metrics.testRmse != null) {
    push('R² (test)', metrics.r2Score, (v) => formatMetric(v));
    push('RMSE (test)', metrics.testRmse, (v) => formatMetric(v));
    push('MAE (test)', metrics.testMae, (v) => formatMetric(v));
    push('MSE (test)', metrics.testMse, (v) => formatMetric(v));
    push('Pérdida (test)', metrics.testLoss ?? metrics.loss, (v) => formatMetric(v));
  } else {
    push('Exactitud (test)', metrics.testAccuracy ?? metrics.accuracy, (v) => formatPercent(v));
    push('Pérdida (test)', metrics.testLoss ?? metrics.loss, (v) => formatMetric(v));
    push('F1-Score', metrics.f1Score, (v) => formatMetric(v));
    push('Precisión', metrics.precision, (v) => formatMetric(v));
    push('Sensibilidad (recall)', metrics.recall, (v) => formatMetric(v));
  }

  if (metrics.epochsCompleted != null) {
    entries.push({
      label: 'Épocas completadas',
      value: formatNumber(metrics.epochsCompleted),
      raw: metrics.epochsCompleted,
    });
  }
  if (metrics.samplesTest != null) {
    entries.push({
      label: 'Muestras de prueba',
      value: formatNumber(metrics.samplesTest),
      raw: metrics.samplesTest,
    });
  }
  return entries;
}

function describeLayers(architecture: Architecture | null): string[] {
  if (!architecture) return [];
  const layers = architecture.config.layers || [];
  return layers.map((layer, index) => {
    const details: string[] = [`Capa ${index + 1}: ${layer.type}`];
    if (layer.units != null) details.push(`${layer.units} unidades`);
    if (layer.filters != null) details.push(`${layer.filters} filtros`);
    if (layer.kernelSize) details.push(`kernel ${layer.kernelSize.join('x')}`);
    if (layer.poolSize) details.push(`pool ${layer.poolSize.join('x')}`);
    if (layer.rate != null) details.push(`dropout ${layer.rate}`);
    if (layer.activation) details.push(`activación ${layer.activation}`);
    if (layer.returnSequences != null) details.push(`return_sequences=${layer.returnSequences}`);
    return details.join(' · ');
  });
}

export const ReportsView: React.FC = () => {
  const { activeProject, showToast } = useApp();
  const { user } = useAuth();

  const [models, setModels] = useState<ModelVersion[]>([]);
  const [architectures, setArchitectures] = useState<Architecture[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [validation, setValidation] = useState<ArchitectureValidationResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [includeTopology, setIncludeTopology] = useState(true);
  const [includeMetrics, setIncludeMetrics] = useState(true);
  const [includeAudit, setIncludeAudit] = useState(true);

  const loadData = useCallback(
    async (silent = false) => {
      if (!activeProject) return;
      if (!silent) setLoading(true);
      try {
        const [modelResult, archResult, datasetResult, jobResult, auditResult] = await Promise.allSettled([
          ApiClient.listModels(activeProject.id),
          ApiClient.listArchitectures(activeProject.id),
          ApiClient.listDatasets(activeProject.id),
          ApiClient.listTrainingJobs(activeProject.id),
          ApiClient.listAuditEvents(activeProject.id, undefined, 200),
        ]);
        const failures: string[] = [];
        if (modelResult.status === 'fulfilled') setModels(modelResult.value);
        else failures.push('modelos');
        if (archResult.status === 'fulfilled') setArchitectures(archResult.value);
        else failures.push('arquitecturas');
        if (datasetResult.status === 'fulfilled') setDatasets(datasetResult.value);
        else failures.push('datasets');
        if (jobResult.status === 'fulfilled') setJobs(jobResult.value);
        else failures.push('entrenamientos');
        if (auditResult.status === 'fulfilled') setAuditEvents(auditResult.value);
        else failures.push('auditoría');

        setError(failures.length ? `No fue posible cargar: ${failures.join(', ')}` : null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No fue posible cargar los datos del reporte');
      } finally {
        setLoading(false);
      }
    },
    [activeProject],
  );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    setSelectedModelId((current) => {
      if (current && models.some((model) => model.id === current)) return current;
      return models[0]?.id ?? null;
    });
  }, [models]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData(true);
    setRefreshing(false);
  };

  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId) || null,
    [models, selectedModelId],
  );

  const selectedJob = useMemo(
    () => (selectedModel ? jobs.find((job) => job.id === selectedModel.jobId) || null : null),
    [jobs, selectedModel],
  );

  const selectedArchitecture = useMemo(
    () =>
      (selectedJob ? architectures.find((arch) => arch.id === selectedJob.architectureId) : null) ||
      null,
    [architectures, selectedJob],
  );

  const selectedDataset = useMemo(
    () =>
      (selectedJob ? datasets.find((dataset) => dataset.id === selectedJob.datasetId) : null) || null,
    [datasets, selectedJob],
  );

  useEffect(() => {
    let cancelled = false;
    if (!activeProject || !selectedArchitecture) {
      setValidation(null);
      setValidationError(null);
      return;
    }
    setValidationError(null);
    ApiClient.validateArchitecture(
      activeProject.id,
      selectedArchitecture.config,
      selectedArchitecture.family,
    )
      .then((result) => {
        if (!cancelled) setValidation(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setValidation(null);
          setValidationError(err instanceof Error ? err.message : 'Validación no disponible');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeProject, selectedArchitecture]);

  const metrics = useMemo(
    () => metricEntries(selectedModel, selectedDataset),
    [selectedModel, selectedDataset],
  );

  const relatedAudit = useMemo(() => {
    if (!selectedModel) return [];
    const modelId = selectedModel.id;
    const jobId = selectedModel.jobId;
    const related = auditEvents.filter((event) => {
      const meta = event.metadata || {};
      return meta.model_id === modelId || meta.job_id === jobId;
    });
    return related.length ? related : auditEvents.slice(0, 6);
  }, [auditEvents, selectedModel]);

  const reportReference = selectedModel
    ? `NL-${shortId(activeProject?.id, 6)}-${shortId(selectedModel.id, 6)}`.toUpperCase()
    : 'NL-SIN-MODELO';

  const handleExportCSV = () => {
    if (!activeProject) return;
    if (!selectedModel) {
      showToast('Seleccione una versión de modelo para exportar el reporte', 'warning');
      return;
    }
    const rows: string[][] = [
      ['Modulo', 'Campo', 'Valor'],
      ['Proyecto', 'ID', activeProject.id],
      ['Proyecto', 'Nombre', activeProject.name],
      ['Proyecto', 'Descripcion', activeProject.description || ''],
      ['Modelo', 'Version', selectedModel.version],
      ['Modelo', 'Estado', selectedModel.status],
      ['Modelo', 'JobID', selectedModel.jobId],
      ['Modelo', 'Registrado', selectedModel.createdAt],
      ['Modelo', 'SHA256', selectedModel.checksum],
      ['Modelo', 'StorageKey', selectedModel.storageKey],
    ];
    if (includeTopology && selectedArchitecture) {
      rows.push(['Arquitectura', 'Nombre', selectedArchitecture.name]);
      rows.push(['Arquitectura', 'Familia', selectedArchitecture.family]);
      rows.push(['Arquitectura', 'VersionConfig', String(selectedArchitecture.version)]);
      rows.push(['Arquitectura', 'InputShape', selectedArchitecture.config.inputShape.join('x')]);
      describeLayers(selectedArchitecture).forEach((line) => rows.push(['Arquitectura', 'Capa', line]));
      if (validation?.totalParameters != null) {
        rows.push(['Arquitectura', 'ParametrosTotales', String(validation.totalParameters)]);
        rows.push(['Arquitectura', 'ParametrosEntrenables', String(validation.trainableParameters)]);
        rows.push(['Arquitectura', 'OutputShape', validation.outputShape.join('x')]);
      }
    }
    if (selectedDataset) {
      rows.push(['Dataset', 'Nombre', selectedDataset.name]);
      rows.push(['Dataset', 'Version', selectedDataset.version]);
      rows.push(['Dataset', 'Muestras', String(selectedDataset.metadata.samples)]);
      rows.push(['Dataset', 'Target', selectedDataset.targetColumn || selectedDataset.metadata.targetColumn || '']);
      rows.push(['Dataset', 'Task', selectedDataset.metadata.task || '']);
      rows.push(['Dataset', 'SHA256', selectedDataset.checksum || '']);
      rows.push([
        'Dataset',
        'Splits',
        `${selectedDataset.metadata.trainSplit}/${selectedDataset.metadata.valSplit}/${selectedDataset.metadata.testSplit}`,
      ]);
    }
    if (includeMetrics) {
      metrics.forEach((entry) => rows.push(['Evaluacion', entry.label, entry.value]));
    }
    if (includeAudit) {
      relatedAudit.forEach((event) =>
        rows.push(['Auditoria', `${event.createdAt} ${event.action}`, event.actorName || event.actorId || 'sistema']),
      );
    }

    const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
    downloadBlob(
      `\uFEFF${csv}`,
      `reporte_${safeFilename(activeProject.name)}_${safeFilename(selectedModel.version)}.csv`,
      'text/csv;charset=utf-8;',
    );
    showToast('Reporte CSV generado con datos persistidos', 'success');
  };

  const handleExportJSON = () => {
    if (!activeProject) return;
    if (!selectedModel) {
      showToast('Seleccione una versión de modelo para exportar la ficha técnica', 'warning');
      return;
    }
    const payload = {
      reference: reportReference,
      generatedAt: new Date().toISOString(),
      generatedBy: user ? { id: user.id, email: user.email, name: user.displayName } : null,
      project: activeProject,
      model: selectedModel,
      job: selectedJob,
      architecture: selectedArchitecture
        ? {
            ...selectedArchitecture,
            layers: describeLayers(selectedArchitecture),
            validation,
          }
        : null,
      dataset: selectedDataset,
      metrics: metrics.map((entry) => ({ label: entry.label, value: entry.raw })),
      auditTrail: includeAudit ? relatedAudit : [],
    };
    downloadBlob(
      JSON.stringify(payload, null, 2),
      `model_card_${safeFilename(activeProject.name)}_${safeFilename(selectedModel.version)}.json`,
      'application/json',
    );
    showToast('Ficha técnica JSON exportada con datos persistidos', 'success');
  };

  const printReport = () => {
    window.print();
  };

  if (!activeProject) {
    return (
      <div className="space-y-4 animate-in fade-in duration-200">
        <ReportsHeader onRefresh={handleRefresh} refreshing={refreshing} disabled />
        <ProjectRequired action="Seleccione un proyecto para generar reportes y fichas técnicas." />
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-black/10 dark:border-white/10">
        <div>
          <div className="flex items-center gap-2 text-zinc-600 dark:text-white/60 text-xs font-semibold uppercase tracking-wider">
            <FileSpreadsheet className="w-4 h-4 text-zinc-700 dark:text-white/80" /> Módulo 09 • Ficha Técnica &amp; Reportes
          </div>
          <h1 className="text-xl sm:text-2xl font-semibold text-zinc-900 dark:text-white mt-1">
            Certificación Formal &amp; Trazabilidad de Modelos
          </h1>
          <p className="text-xs text-zinc-500 dark:text-white/65 mt-0.5">
            Documentación generada exclusivamente a partir de datos persistidos: topología, métricas de
            evaluación y pista de auditoría.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleRefresh}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl glass-btn-secondary text-xs font-medium"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Actualizar
          </button>
          <button
            onClick={handleExportCSV}
            disabled={!selectedModel}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl glass-btn-secondary text-xs font-medium disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" /> Exportar CSV
          </button>
          <button
            onClick={handleExportJSON}
            disabled={!selectedModel}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl glass-btn-secondary text-xs font-medium disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" /> Exportar JSON
          </button>
          <button
            onClick={printReport}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl glass-btn-primary text-xs font-semibold"
          >
            <Printer className="w-3.5 h-3.5" /> Imprimir / PDF
          </button>
        </div>
      </div>

      {loading && <LoadingBlock label="Consolidando datos del proyecto…" />}
      {!loading && error && <ErrorBlock message={error} onRetry={() => loadData()} />}

      {!loading && !error && models.length === 0 && (
        <EmptyBlock
          icon={Box}
          title="No hay versiones de modelo para reportar"
          description="El reporte se genera a partir de una versión inmutable existente. Complete un entrenamiento exitoso para habilitar la ficha técnica."
        />
      )}

      {models.length > 0 && (
        <>
          <div className="glass-card p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-xs">
              <label className="text-zinc-500 dark:text-white/65 font-medium">Versión a certificar:</label>
              <select
                value={selectedModelId || ''}
                onChange={(event) => setSelectedModelId(event.target.value || null)}
                className="glass-input rounded-xl px-3 py-1.5 text-xs bg-transparent dark:bg-zinc-900 text-zinc-900 dark:text-white min-w-[220px]"
              >
                {models.map((model) => (
                  <option
                    key={model.id}
                    value={model.id}
                    className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white"
                  >
                    {model.version} · {model.status} · {formatDateTime(model.createdAt)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-700 dark:text-white/70">
              <span className="font-semibold text-zinc-900 dark:text-white">Secciones:</span>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeTopology}
                  onChange={(event) => setIncludeTopology(event.target.checked)}
                  className="rounded accent-zinc-900 dark:accent-white cursor-pointer"
                />
                <span>Topología</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeMetrics}
                  onChange={(event) => setIncludeMetrics(event.target.checked)}
                  className="rounded accent-zinc-900 dark:accent-white cursor-pointer"
                />
                <span>Métricas</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeAudit}
                  onChange={(event) => setIncludeAudit(event.target.checked)}
                  className="rounded accent-zinc-900 dark:accent-white cursor-pointer"
                />
                <span>Auditoría</span>
              </label>
            </div>
          </div>

          {selectedModel ? (
            <div className="glass-card p-8 rounded-3xl space-y-6 text-xs text-zinc-800 dark:text-white/80 print:shadow-none print:border-none print:p-0">
              <div className="border-b border-black/10 dark:border-white/10 pb-5 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-zinc-600 dark:text-white/60 font-semibold text-xs tracking-wider mb-1">
                    <ShieldCheck className="w-4 h-4 text-zinc-700 dark:text-white/80" /> NEUROLAB ENTERPRISE • FICHA TÉCNICA
                  </div>
                  <h2 className="text-xl font-bold text-zinc-900 dark:text-white tracking-tight">
                    FICHA DE AUDITORÍA DEL MODELO
                  </h2>
                  <p className="text-zinc-500 dark:text-white/65 mt-0.5">
                    Documento generado desde PostgreSQL y el artefacto inmutable del worker.
                  </p>
                </div>
                <div className="sm:text-right">
                  <span className="font-mono text-zinc-900 dark:text-white font-bold px-3 py-1 rounded-full glass-inset border border-black/20 dark:border-white/20">
                    ESTADO: {selectedModel.status}
                  </span>
                  <p className="text-zinc-500 dark:text-white/65 text-xs mt-1.5 font-mono">
                    Ref: {reportReference} · Emisión: {formatDateTime(new Date().toISOString())}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-2xl glass-inset border border-black/10 dark:border-white/10">
                <div>
                  <span className="text-zinc-500 dark:text-white/65 text-xs uppercase font-bold tracking-wider">Proyecto</span>
                  <p className="font-semibold text-zinc-900 dark:text-white mt-0.5">{activeProject.name}</p>
                  <p className="text-xs text-zinc-500 dark:text-white/65 font-mono mt-0.5">
                    {shortId(activeProject.id, 12)}
                  </p>
                </div>
                <div>
                  <span className="text-zinc-500 dark:text-white/65 text-xs uppercase font-bold tracking-wider">Modelo</span>
                  <p className="font-semibold text-zinc-900 dark:text-white mt-0.5 font-mono">{selectedModel.version}</p>
                  <p className="text-xs text-zinc-500 dark:text-white/65 mt-0.5">
                    Registrado {formatDateTime(selectedModel.createdAt)}
                  </p>
                </div>
                <div>
                  <span className="text-zinc-500 dark:text-white/65 text-xs uppercase font-bold tracking-wider">Trabajo de origen</span>
                  <p className="font-semibold text-zinc-900 dark:text-white mt-0.5 font-mono">
                    {shortId(selectedModel.jobId, 12)}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-white/65 mt-0.5">
                    {selectedJob ? selectedJob.status : 'No disponible en este proyecto'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-2xl glass-inset border border-black/10 dark:border-white/10 space-y-1">
                  <div className="flex items-center gap-2 text-zinc-700 dark:text-white/70 font-semibold">
                    <Layers className="w-3.5 h-3.5" /> Arquitectura
                  </div>
                  {selectedArchitecture ? (
                    <>
                      <p className="text-zinc-900 dark:text-white font-medium">{selectedArchitecture.name}</p>
                      <p className="text-xs text-zinc-500 dark:text-white/65 font-mono">
                        {selectedArchitecture.family} · config v{selectedArchitecture.version}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-white/65 font-mono">
                        Entrada [{selectedArchitecture.config.inputShape.join(', ')}]
                      </p>
                      {validation?.totalParameters != null && (
                        <p className="text-xs text-zinc-500 dark:text-white/65 font-mono">
                          {formatNumber(validation.totalParameters)} parámetros totales ·{' '}
                          {formatNumber(validation.trainableParameters)} entrenables
                        </p>
                      )}
                      {validationError && (
                        <p className="text-xs text-amber-600 dark:text-amber-300">{validationError}</p>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-zinc-500 dark:text-white/65">
                      Arquitectura no disponible para este job.
                    </p>
                  )}
                </div>

                <div className="p-4 rounded-2xl glass-inset border border-black/10 dark:border-white/10 space-y-1">
                  <div className="flex items-center gap-2 text-zinc-700 dark:text-white/70 font-semibold">
                    <Database className="w-3.5 h-3.5" /> Conjunto de datos de referencia
                  </div>
                  {selectedDataset ? (
                    <>
                      <p className="text-zinc-900 dark:text-white font-medium">{selectedDataset.name}</p>
                      <p className="text-xs text-zinc-500 dark:text-white/65 font-mono">
                        versión {selectedDataset.version} · {formatNumber(selectedDataset.metadata.samples)} muestras
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-white/65 font-mono">
                        objetivo: {selectedDataset.targetColumn || selectedDataset.metadata.targetColumn || '—'} ·{' '}
                        {selectedDataset.metadata.task || '—'}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-white/65 font-mono break-all">
                        SHA-256: {selectedDataset.checksum || '—'}
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-zinc-500 dark:text-white/65">
                      Conjunto de datos no disponible para este trabajo.
                    </p>
                  )}
                </div>
              </div>

              {includeTopology && selectedArchitecture && (
                <div className="space-y-2">
                  <span className="text-zinc-600 dark:text-white/65 text-xs uppercase font-bold tracking-wider">
                    1. Especificación de la topología compilada
                  </span>
                  <div className="p-4 glass-inset rounded-2xl border border-black/10 dark:border-white/10 font-mono text-xs space-y-1.5 text-zinc-800 dark:text-white/80">
                    <div>• Tensor de entrada: [{selectedArchitecture.config.inputShape.join(', ')}]</div>
                    {describeLayers(selectedArchitecture).map((line) => (
                      <div key={line} className="text-zinc-700 dark:text-white/70">
                        • {line}
                      </div>
                    ))}
                    {validation && (
                      <div className="pt-2 text-zinc-900 dark:text-white font-semibold border-t border-black/10 dark:border-white/10">
                        • Salida: [{validation.outputShape.map((value) => value ?? '?').join(', ')}] ·{' '}
                        {formatNumber(validation.totalParameters)} parámetros
                      </div>
                    )}
                  </div>
                </div>
              )}

              {includeMetrics && (
                <div className="space-y-2">
                  <span className="text-zinc-600 dark:text-white/65 text-xs uppercase font-bold tracking-wider">
                    2. Resultados de evaluación persistidos
                  </span>
                  {metrics.length === 0 ? (
                    <p className="text-xs text-zinc-500 dark:text-white/65 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" /> Esta versión no registra métricas de evaluación.
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                      {metrics.map((entry) => (
                        <div
                          key={entry.label}
                          className="p-3.5 glass-inset rounded-2xl border border-black/10 dark:border-white/10"
                        >
                          <span className="text-zinc-500 dark:text-white/65 text-xs uppercase font-bold tracking-wider">
                            {entry.label}
                          </span>
                          <p className="font-semibold text-zinc-900 dark:text-white font-mono text-base mt-1">
                            {entry.value}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {includeTopology && selectedArchitecture && selectedArchitecture.config.layers.length > 0 && (
                <div className="space-y-2">
                  <span className="text-zinc-600 dark:text-white/65 text-xs uppercase font-bold tracking-wider">
                    3. Hiperparámetros del trabajo
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    {[
                      ['Épocas', selectedJob?.hyperparameters.epochs],
                      ['Tamaño de lote', selectedJob?.hyperparameters.batchSize],
                      ['Optimizador', selectedJob?.hyperparameters.optimizer],
                      ['Tasa de aprendizaje', selectedJob?.hyperparameters.learningRate],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="p-2.5 glass-inset rounded-xl">
                        <span className="text-zinc-500 dark:text-white/65 text-xs uppercase font-bold">
                          {label}
                        </span>
                        <p className="font-mono font-semibold text-zinc-900 dark:text-white mt-0.5">
                          {value != null ? String(value) : '—'}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {includeAudit && (
                <div className="space-y-2 pt-2 border-t border-black/10 dark:border-white/10">
                  <span className="text-zinc-600 dark:text-white/65 text-xs uppercase font-bold tracking-wider">
                    4. Trazabilidad inmutable &amp; auditoría
                  </span>
                  <div className="p-3.5 glass-inset rounded-2xl border border-black/10 dark:border-white/10 font-mono text-xs text-zinc-800 dark:text-white/70 break-all flex items-start gap-2">
                    <FileCheck2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>Checksum SHA-256 del artefacto: {selectedModel.checksum}</span>
                  </div>
                  {relatedAudit.length === 0 ? (
                    <p className="text-xs text-zinc-500 dark:text-white/65">
                      No hay eventos de auditoría asociados a este modelo en el proyecto.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs font-mono">
                        <thead>
                          <tr className="border-b border-black/10 dark:border-white/10 text-zinc-500 dark:text-white/65 font-sans">
                            <th className="pb-2 font-medium">Fecha</th>
                            <th className="pb-2 font-medium">Actor</th>
                            <th className="pb-2 font-medium">Acción</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-black/5 dark:divide-white/5">
                          {relatedAudit.map((event) => (
                            <tr key={event.id}>
                              <td className="py-1.5 text-zinc-500 dark:text-white/65 font-sans">
                                {formatDateTime(event.createdAt)}
                              </td>
                              <td className="py-1.5 text-zinc-700 dark:text-white/70">
                                {event.actorName || shortId(event.actorId, 8)}
                              </td>
                              <td className="py-1.5 text-zinc-900 dark:text-white font-medium">{event.action}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs text-zinc-500 dark:text-white/65 pt-1 gap-1">
                    <span>
                      Generado por {user?.displayName || user?.email || 'usuario autenticado'} · NeuroLab Enterprise
                    </span>
                    <span className="font-mono">Origen: PostgreSQL + artefacto del worker</span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <EmptyBlock
              icon={PlayCircle}
              title="Seleccione una versión de modelo"
              description="Elija una versión del registro para construir la ficha técnica con sus datos reales."
            />
          )}
        </>
      )}

      {!loading && models.length > 0 && selectedJob && (
        <div className="glass-card p-4 rounded-2xl flex flex-wrap items-center gap-4 text-xs text-zinc-500 dark:text-white/65">
          <span className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5" /> Job {shortId(selectedJob.id, 12)} · {selectedJob.status}
          </span>
          <span>{jobs.length} trabajo(s) en el proyecto</span>
          <span>{architectures.length} arquitectura(s)</span>
          <span>{datasets.length} dataset(s)</span>
          <span>{auditEvents.length} evento(s) de auditoría</span>
        </div>
      )}
    </div>
  );
};

const ReportsHeader: React.FC<{ onRefresh: () => void; refreshing: boolean; disabled?: boolean }> = ({
  onRefresh,
  refreshing,
  disabled,
}) => (
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-black/10 dark:border-white/10">
    <div>
      <div className="flex items-center gap-2 text-zinc-600 dark:text-white/60 text-xs font-semibold uppercase tracking-wider">
        <FileSpreadsheet className="w-4 h-4 text-zinc-700 dark:text-white/80" /> Módulo 09 • Ficha Técnica &amp; Reportes
      </div>
      <h1 className="text-xl sm:text-2xl font-semibold text-zinc-900 dark:text-white mt-1">
        Certificación Formal &amp; Trazabilidad de Modelos
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
