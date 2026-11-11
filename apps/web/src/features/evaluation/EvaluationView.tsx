import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LineChart,
  Target,
  Award,
  Maximize2,
  Info,
  CheckCircle2,
  RefreshCw,
  AlertTriangle,
  BarChart3,
  Box,
  Database,
  Cpu,
} from 'lucide-react';
import { useApp } from '../../lib/AppContext';
import { ApiClient } from '../../lib/api';
import { EnlargedChartModal } from '../../components/common/EnlargedChartModal';
import {
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  ProjectRequiredPage,
} from '../../components/common/ProjectGuard';
import { formatDateTime, formatMetric, formatNumber, formatPercent, shortId } from '../../lib/format';
import { MODEL_STATUS_LABELS, labelFor } from '../../lib/labels';
import { ModelVersion } from '../../types';

function metricValue(value?: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const MODEL_STATUS_STYLES: Record<string, string> = {
  DRAFT: 'border-zinc-500/35 text-zinc-700 dark:text-zinc-200 bg-zinc-500/10',
  REVIEWED: 'border-sky-500/35 text-sky-700 dark:text-sky-300 bg-sky-500/10',
  APPROVED: 'border-emerald-500/35 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10',
  RETIRED: 'border-amber-500/35 text-amber-700 dark:text-amber-300 bg-amber-500/10',
};

function ModelStatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${
        MODEL_STATUS_STYLES[status] ?? MODEL_STATUS_STYLES.DRAFT
      }`}
    >
      {labelFor(MODEL_STATUS_LABELS, status)}
    </span>
  );
}

interface ConfusionMatrixProps {
  matrix: number[][];
  labels: (string | number)[];
  large?: boolean;
}

function ConfusionMatrix({ matrix, labels, large = false }: ConfusionMatrixProps) {
  const max = Math.max(1, ...matrix.flat());
  const total = matrix.flat().reduce((sum, value) => sum + value, 0);
  const correct = matrix.reduce((sum, row, index) => sum + (row[index] ?? 0), 0);
  const wrong = Math.max(0, total - correct);

  return (
    <div className="overflow-auto">
      <table className="w-full text-center text-sm font-mono border-separate border-spacing-1">
        <caption className="sr-only">
          Matriz de confusión: filas reales, columnas predichas. Verde para aciertos y rojo para errores.
        </caption>
        <thead>
          <tr className="text-zinc-600 dark:text-white/65">
            <th scope="col" className="p-1.5 text-left font-sans font-medium text-xs uppercase tracking-wider">
              Real \ Pred.
            </th>
            {labels.map((label, index) => (
              <th key={`${label}-${index}`} scope="col" className="p-1.5 font-medium text-xs">
                {String(label)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, rowIndex) => (
            <tr key={rowIndex}>
              <th
                scope="row"
                className="p-1.5 text-left font-sans font-medium text-xs text-zinc-700 dark:text-white/75 whitespace-nowrap"
              >
                {String(labels[rowIndex] ?? rowIndex)}
              </th>
              {row.map((value, colIndex) => {
                const correctlyClassified = rowIndex === colIndex;
                const intensity = value / max;
                return (
                  <td
                    key={colIndex}
                    className={`p-2 rounded-lg font-semibold ${
                      correctlyClassified
                        ? 'text-emerald-950 dark:text-emerald-50'
                        : 'text-rose-950 dark:text-rose-50'
                    }`}
                    style={{
                      backgroundColor: correctlyClassified
                        ? `rgba(16, 185, 129, ${0.18 + intensity * 0.52})`
                        : `rgba(244, 63, 94, ${0.08 + intensity * 0.42})`,
                      boxShadow:
                        value > 0
                          ? correctlyClassified
                            ? '0 0 10px rgba(16, 185, 129, 0.25)'
                            : '0 0 10px rgba(244, 63, 94, 0.20)'
                          : 'none',
                    }}
                    title={`Real ${labels[rowIndex]} → Predicho ${labels[colIndex]}: ${formatNumber(value)}`}
                  >
                    {formatNumber(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2 text-xs text-zinc-700 dark:text-white/70">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-emerald-500/70 border border-emerald-600/50" aria-hidden="true" />
          Aciertos: <strong className="font-mono">{formatNumber(correct)}</strong>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-rose-500/70 border border-rose-600/50" aria-hidden="true" />
          Errores: <strong className="font-mono">{formatNumber(wrong)}</strong>
        </span>
        <span className="text-zinc-600 dark:text-white/65">
          Total de prueba: <strong className="font-mono">{formatNumber(total)}</strong>
        </span>
      </div>

      {large && (
        <p className="text-xs text-zinc-600 dark:text-white/65 mt-2 leading-relaxed">
          La diagonal principal son las clasificaciones correctas. Las celdas fuera de la diagonal
          son errores del modelo sobre el conjunto de prueba reservado.
        </p>
      )}
    </div>
  );
}

export const EvaluationView: React.FC = () => {
  const { activeProject } = useApp();
  const projectId = activeProject?.id;

  const [models, setModels] = useState<ModelVersion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enlargedOpen, setEnlargedOpen] = useState(false);

  const loadModels = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const list = await ApiClient.listModels(projectId);
      setModels(list);
      setSelectedId((current) => {
        if (current && list.some((model) => model.id === current)) return current;
        return list[0]?.id ?? null;
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible cargar las evaluaciones');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setModels([]);
    setSelectedId(null);
    if (projectId) void loadModels();
  }, [projectId, loadModels]);

  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedId) || null,
    [models, selectedId],
  );
  const metrics = selectedModel?.metricsSummary || null;

  const accuracy = metricValue(metrics?.testAccuracy ?? metrics?.accuracy);
  const loss = metricValue(metrics?.testLoss ?? metrics?.loss);
  const f1 = metricValue(metrics?.f1Score);
  const precision = metricValue(metrics?.precision);
  const recall = metricValue(metrics?.recall);
  const r2 = metricValue(metrics?.r2Score);
  const rmse = metricValue(metrics?.testRmse);
  const mae = metricValue(metrics?.testMae);
  const isRegression =
    metrics?.task === 'regression' ||
    (!metrics?.confusionMatrix && r2 != null) ||
    (!accuracy && r2 != null);

  const bestId = useMemo(() => {
    const best = models.reduce<{ id: string; score: number } | null>((current, model) => {
      const score =
        metricValue(model.metricsSummary?.testAccuracy ?? model.metricsSummary?.accuracy) ??
        metricValue(model.metricsSummary?.f1Score) ??
        metricValue(model.metricsSummary?.r2Score);
      if (score == null) return current;
      if (!current || score > current.score) return { id: model.id, score };
      return current;
    }, null);
    return best ? best.id : null;
  }, [models]);

  if (!activeProject) {
    return (
      <ProjectRequiredPage
        icon={LineChart}
        eyebrow="Módulo 07 • Evaluación & Métricas"
        title="Rendimiento y referencias del modelo"
        description="Resultados calculados por el worker sobre el conjunto de prueba reservado (15%). No se generan métricas ni curvas sintéticas en el cliente."
        action="Seleccione un proyecto para consultar las métricas de sus modelos."
      />
    );
  }

  const matrix = metrics?.confusionMatrix;
  const labels = metrics?.classLabels || matrix?.map((_, index) => index) || [];

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-black/10 dark:border-white/10">
        <div>
          <div className="flex items-center gap-2 text-zinc-600 dark:text-white/60 text-xs font-semibold uppercase tracking-wider">
            <LineChart className="w-4 h-4 text-zinc-800 dark:text-white/80" /> Módulo 07 •
            Evaluación & Métricas
          </div>
          <h1 className="text-xl sm:text-2xl font-semibold text-zinc-900 dark:text-white mt-1">
            Rendimiento y referencias del modelo
          </h1>
          <p className="text-xs text-zinc-600 dark:text-white/65 mt-0.5">
            Resultados calculados por el worker sobre el conjunto de prueba reservado (15%). No se
            generan métricas ni curvas sintéticas en el cliente.
          </p>
        </div>

        <button
          onClick={loadModels}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl glass-btn-secondary text-xs font-medium self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Actualizar
        </button>
      </div>

      {error && <ErrorBlock message={error} onRetry={loadModels} />}
      {loading && <LoadingBlock label="Cargando versiones de modelo…" />}

      {!loading && !error && models.length === 0 && (
        <EmptyBlock
          title="Aún no hay modelos evaluados"
          description="Complete un entrenamiento real para generar una versión inmutable con métricas de prueba."
          icon={BarChart3}
        />
      )}

      {selectedModel && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-white/60">
            <span className="font-medium">Versión evaluada:</span>
            <span className="font-mono px-2 py-0.5 rounded-full glass-inset border border-black/10 dark:border-white/10 text-zinc-900 dark:text-white">
              {selectedModel.version}
            </span>
            <span className="font-mono text-xs text-zinc-500 dark:text-white/65">
              job {shortId(selectedModel.jobId, 12)}
            </span>
            <ModelStatusPill status={selectedModel.status} />
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div className="glass-card p-4 rounded-2xl">
              <span className="text-xs text-zinc-500 dark:text-white/65 font-medium">
                {isRegression ? 'Coeficiente R²' : 'Exactitud en prueba'}
              </span>
              <div className="text-xl font-bold text-zinc-900 dark:text-white font-mono mt-1">
                {isRegression ? formatMetric(r2, 3) : formatPercent(accuracy)}
              </div>
              <span className="text-xs text-zinc-500 dark:text-white/65">
                {metrics ? `Calculado sobre ${formatNumber(metrics.samplesTest)} muestras` : 'Sin datos'}
              </span>
            </div>

            <div className="glass-card p-4 rounded-2xl">
              <span className="text-xs text-zinc-500 dark:text-white/65 font-medium">
                Pérdida en prueba
              </span>
              <div className="text-xl font-bold text-zinc-900 dark:text-white font-mono mt-1">
                {formatMetric(loss)}
              </div>
              <span className="text-xs text-zinc-500 dark:text-white/65">
                Función de coste final
              </span>
            </div>

            <div className="glass-card p-4 rounded-2xl">
              <span className="text-xs text-zinc-500 dark:text-white/65 font-medium">
                {isRegression ? 'RMSE' : 'F1-Score'}
              </span>
              <div className="text-xl font-bold text-zinc-900 dark:text-white font-mono mt-1">
                {isRegression ? formatMetric(rmse) : formatMetric(f1, 3)}
              </div>
              <span className="text-xs text-zinc-500 dark:text-white/65">
                {isRegression ? 'Error cuadrático medio' : 'Media armónica ponderada'}
              </span>
            </div>

            <div className="glass-card p-4 rounded-2xl">
              <span className="text-xs text-zinc-500 dark:text-white/65 font-medium">
                {isRegression ? 'MAE' : 'Precisión / Exhaustividad'}
              </span>
              <div className="text-xl font-bold text-zinc-900 dark:text-white font-mono mt-1">
                {isRegression
                  ? formatMetric(mae)
                  : `${formatMetric(precision, 2)} / ${formatMetric(recall, 2)}`}
              </div>
              <span className="text-xs text-zinc-500 dark:text-white/65">
                {isRegression ? 'Error absoluto medio' : 'Sobre la clase positiva / ponderado'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-4">
              {/* Model comparison */}
              <div className="glass-card p-5 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold text-zinc-900 dark:text-white/90 flex items-center gap-1.5 uppercase tracking-wider">
                    <Award className="w-3.5 h-3.5 text-zinc-600 dark:text-white/70" /> Versiones
                    registradas
                  </h2>
                  <span className="text-xs text-zinc-500 dark:text-white/65 font-mono">
                    {models.length} versiones
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-black/10 dark:border-white/10 text-zinc-500 dark:text-white/65">
                        <th className="pb-2.5 font-medium">Versión</th>
                        <th className="pb-2.5 font-medium">Estado</th>
                        <th className="pb-2.5 font-medium">
                          {isRegression ? 'R²' : 'Exactitud de prueba'}
                        </th>
                        <th className="pb-2.5 font-medium">Pérdida en prueba</th>
                        <th className="pb-2.5 font-medium">{isRegression ? 'RMSE' : 'F1'}</th>
                        <th className="pb-2.5 font-medium">Registrado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5 dark:divide-white/5 font-mono">
                      {models.map((model) => {
                        const rowMetrics = model.metricsSummary;
                        const rowAccuracy = metricValue(rowMetrics?.testAccuracy ?? rowMetrics?.accuracy);
                        const rowLoss = metricValue(rowMetrics?.testLoss ?? rowMetrics?.loss);
                        const rowF1 = metricValue(rowMetrics?.f1Score);
                        const rowR2 = metricValue(rowMetrics?.r2Score);
                        const rowRmse = metricValue(rowMetrics?.testRmse);
                        const isSelected = model.id === selectedId;
                        return (
                          <tr
                            key={model.id}
                            onClick={() => setSelectedId(model.id)}
                            className={`cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-black/5 dark:bg-white/10'
                                : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.04]'
                            }`}
                          >
                            <td className="py-3 font-sans font-medium text-zinc-900 dark:text-white">
                              {model.version}
                              {model.id === bestId && (
                                <span className="ml-2 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40 font-semibold">
                                  <Award className="w-3 h-3" aria-hidden="true" /> Mejor métrica
                                </span>
                              )}
                            </td>
                            <td className="py-3 font-sans">
                              <ModelStatusPill status={model.status} />
                            </td>
                            <td className="py-3 text-zinc-900 dark:text-white/90">
                              {rowMetrics?.task === 'regression' || rowR2 != null
                                ? formatMetric(rowR2, 3)
                                : formatPercent(rowAccuracy)}
                            </td>
                            <td className="py-3 text-zinc-600 dark:text-white/70">
                              {formatMetric(rowLoss)}
                            </td>
                            <td className="py-3 text-zinc-900 dark:text-white/90">
                              {rowMetrics?.task === 'regression' || rowR2 != null
                                ? formatMetric(rowRmse)
                                : formatMetric(rowF1, 3)}
                            </td>
                            <td className="py-3 text-xs text-zinc-500 dark:text-white/65 whitespace-nowrap">
                              {formatDateTime(model.createdAt)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="glass-card p-5 rounded-2xl space-y-2 text-xs">
                <span className="font-semibold text-zinc-900 dark:text-white/90 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-zinc-600 dark:text-white/70" /> Trazabilidad de
                  la evaluación
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-zinc-600 dark:text-white/60">
                  <div className="p-2.5 rounded-xl glass-inset border border-black/10 dark:border-white/10">
                    <span className="block text-xs uppercase tracking-wider text-zinc-500 dark:text-white/65">
                      Checksum del artefacto
                    </span>
                    <code className="font-mono text-xs break-all text-zinc-800 dark:text-white/80">
                      {selectedModel.checksum}
                    </code>
                  </div>
                  <div className="p-2.5 rounded-xl glass-inset border border-black/10 dark:border-white/10 space-y-1">
                    <div className="flex justify-between">
                      <span>Versión del conjunto de datos</span>
                      <span className="font-mono text-zinc-900 dark:text-white">
                        {metrics?.datasetVersion || '—'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Épocas completadas</span>
                      <span className="font-mono text-zinc-900 dark:text-white">
                        {metrics?.epochsCompleted ?? '—'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Tarea</span>
                      <span className="font-mono text-zinc-900 dark:text-white">
                        {metrics?.task || '—'}
                      </span>
                    </div>
                  </div>
                </div>
                <p className="text-zinc-600 dark:text-white/65 leading-relaxed pt-1">
                  Estas métricas provienen de <code>metrics_summary</code> almacenado al finalizar el
                  trabajo. Si falta una métrica, significa que el worker no la calculó para esa tarea
                  (por ejemplo, F1 no aplica a regresión).
                </p>
              </div>
            </div>

            {/* Right dock */}
            <div className="space-y-3.5">
              <div className="text-xs font-medium text-zinc-600 dark:text-white/65 flex items-center justify-between px-1">
                <span>Resultados de prueba</span>
                <span className="text-xs text-zinc-800 dark:text-white/70">
                  {matrix ? 'Clic para ampliar' : 'Sin matriz'}
                </span>
              </div>

              <div
                onClick={() => matrix && setEnlargedOpen(true)}
                className={`glass-card p-4 rounded-2xl space-y-2 ${
                  matrix ? 'glass-card-hover cursor-pointer' : ''
                }`}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-zinc-900 dark:text-white/90 flex items-center gap-1">
                    <Target className="w-3.5 h-3.5 text-zinc-600 dark:text-white/70" /> Matriz de
                    confusión
                  </span>
                  {matrix && <Maximize2 className="w-3 h-3 text-zinc-400 dark:text-white/65" />}
                </div>

                <div className="p-2 glass-inset rounded-xl overflow-hidden">
                  {matrix ? (
                    <ConfusionMatrix matrix={matrix} labels={labels} />
                  ) : (
                    <div className="h-24 flex items-center justify-center text-xs text-zinc-500 dark:text-white/65 font-mono text-center px-2">
                      {isRegression
                        ? 'No aplica para tareas de regresión'
                        : 'El worker no reportó matriz para esta versión'}
                    </div>
                  )}
                </div>
              </div>

              <div className="glass-card p-4 rounded-2xl text-xs space-y-2 text-zinc-600 dark:text-white/60">
                <span className="font-semibold text-zinc-900 dark:text-white/90 block border-b border-black/10 dark:border-white/10 pb-1.5">
                  Detalle de métricas
                </span>
                {[
                  ['Accuracy', formatPercent(accuracy)],
                  ['Precision', formatMetric(precision)],
                  ['Recall', formatMetric(recall)],
                  ['F1-Score', formatMetric(f1)],
                  ['R²', formatMetric(r2, 3)],
                  ['RMSE', formatMetric(rmse)],
                  ['MAE', formatMetric(mae)],
                  ['Muestras test', formatNumber(metrics?.samplesTest)],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between">
                    <span>{label}</span>
                    <span className="font-mono text-zinc-900 dark:text-white">{value}</span>
                  </div>
                ))}
              </div>

              <div className="glass-card p-4 rounded-2xl text-xs space-y-2 text-zinc-600 dark:text-white/60">
                <span className="font-semibold text-zinc-900 dark:text-white/90 block border-b border-black/10 dark:border-white/10 pb-1.5">
                  Origen
                </span>
                <div className="flex justify-between gap-2">
                  <span className="flex items-center gap-1 shrink-0">
                    <Box className="w-3 h-3" /> Modelo
                  </span>
                  <span className="font-mono text-zinc-900 dark:text-white truncate">
                    {selectedModel.version}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="flex items-center gap-1 shrink-0">
                    <Cpu className="w-3 h-3" /> Job
                  </span>
                  <span className="font-mono text-zinc-900 dark:text-white">
                    {shortId(selectedModel.jobId)}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="flex items-center gap-1 shrink-0">
                    <Database className="w-3 h-3" /> Dataset
                  </span>
                  <span className="font-mono text-zinc-900 dark:text-white truncate">
                    {metrics?.datasetVersion || '—'}
                  </span>
                </div>
                <div className="flex justify-between items-center gap-2">
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Estado
                  </span>
                  <ModelStatusPill status={selectedModel.status} />
                </div>
              </div>

              {!metrics && (
                <div className="glass-card p-3 rounded-2xl border border-amber-500/25 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  Esta versión no contiene métricas de evaluación almacenadas.
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <EnlargedChartModal
        isOpen={enlargedOpen}
        onClose={() => setEnlargedOpen(false)}
        title="Matriz de Confusión Detallada (Test Set)"
        subtitle="Conteo real de predicciones sobre el conjunto de prueba reservado"
        badge={selectedModel ? `v${selectedModel.version}` : 'Evaluación'}
      >
        <div className="space-y-4">
          <div className="p-6 glass-inset rounded-2xl border border-black/10 dark:border-white/10 flex justify-center">
            {matrix ? (
              <ConfusionMatrix matrix={matrix} labels={labels} large />
            ) : (
              <p className="text-xs text-zinc-500 dark:text-white/65">Sin matriz disponible.</p>
            )}
          </div>
          <div className="p-3.5 rounded-2xl glass-inset border border-black/10 dark:border-white/10 text-xs text-zinc-600 dark:text-white/60">
            {matrix
              ? `Exactitud global reportada: ${formatPercent(accuracy)} sobre ${formatNumber(
                  metrics?.samplesTest,
                )} muestras de prueba.`
              : 'El worker no calculó matriz de confusión para esta versión.'}
          </div>
        </div>
      </EnlargedChartModal>
    </div>
  );
};
