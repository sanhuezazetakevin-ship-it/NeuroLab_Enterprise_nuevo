import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FolderGit2,
  Cpu,
  PlayCircle,
  Box,
  Activity,
  CheckCircle2,
  Clock,
  ArrowRight,
  RefreshCw,
  AlertTriangle,
  Loader2,
  Database,
  ShieldCheck,
  Server,
  Radio,
  BookOpen,
  TrendingUp,
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
  JOB_STATUS_LABELS,
  MODEL_STATUS_LABELS,
  PROJECT_STATUS_LABELS,
  ROLE_LABELS,
  SYSTEM_STATUS_LABELS,
  labelFor,
} from '../../lib/labels';
import {
  Architecture,
  AuditEvent,
  Dataset,
  JobStatus,
  ModelVersion,
  SystemStatus,
  TrainingJob,
} from '../../types';
import type { NavTab } from '../../components/layout/Shell';

interface DashboardProps {
  onNavigate: (tab: NavTab) => void;
}

const ACTIVE_STATES: JobStatus[] = ['QUEUED', 'PREPARING', 'RUNNING'];

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
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold glass-inset border ${STATUS_STYLES[status]}`}
    >
      {isActive && <Loader2 className="w-3 h-3 animate-spin" />}
      {status === 'COMPLETED' && <CheckCircle2 className="w-3 h-3" />}
      {status === 'FAILED' && <AlertTriangle className="w-3 h-3" />}
      {labelFor(JOB_STATUS_LABELS, status)}
    </span>
  );
}

function uptimeLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.round(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export const DashboardView: React.FC<DashboardProps> = ({ onNavigate }) => {
  const {
    activeProject,
    projects,
    projectsLoading,
    projectsError,
    refreshProjects,
    setWalkthroughOpen,
    currentRole,
  } = useApp();
  const { user } = useAuth();

  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [models, setModels] = useState<ModelVersion[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [architectures, setArchitectures] = useState<Architecture[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [systemError, setSystemError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const isAdmin = currentRole === 'ADMIN';

  const loadData = useCallback(
    async (silent = false) => {
      if (!activeProject) return;
      if (!silent) setLoading(true);
      try {
        const [jobResult, modelResult, datasetResult, archResult, auditResult, systemResult] =
          await Promise.allSettled([
            ApiClient.listTrainingJobs(activeProject.id),
            ApiClient.listModels(activeProject.id),
            ApiClient.listDatasets(activeProject.id),
            ApiClient.listArchitectures(activeProject.id),
            ApiClient.listAuditEvents(activeProject.id, undefined, 100),
            isAdmin ? ApiClient.systemStatus() : Promise.resolve(null),
          ]);

        const failures: string[] = [];
        if (jobResult.status === 'fulfilled') setJobs(jobResult.value);
        else failures.push('entrenamientos');
        if (modelResult.status === 'fulfilled') setModels(modelResult.value);
        else failures.push('modelos');
        if (datasetResult.status === 'fulfilled') setDatasets(datasetResult.value);
        else failures.push('conjuntos de datos');
        if (archResult.status === 'fulfilled') setArchitectures(archResult.value);
        else failures.push('arquitecturas');
        if (auditResult.status === 'fulfilled') setAuditEvents(auditResult.value);
        else failures.push('auditoría');

        if (systemResult.status === 'fulfilled') {
          setSystem(systemResult.value);
          setSystemError(null);
        } else if (isAdmin) {
          setSystem(null);
          setSystemError(
            systemResult.reason instanceof Error
              ? systemResult.reason.message
              : 'No fue posible consultar el estado del sistema',
          );
        } else {
          setSystem(null);
          setSystemError(null);
        }

        setError(failures.length ? `No fue posible cargar: ${failures.join(', ')}` : null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No fue posible cargar el panel');
      } finally {
        setLoading(false);
      }
    },
    [activeProject, isAdmin],
  );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refreshProjects(), loadData(true)]);
    setRefreshing(false);
  };

  const architectureById = useMemo(() => {
    const map = new Map<string, Architecture>();
    architectures.forEach((arch) => map.set(arch.id, arch));
    return map;
  }, [architectures]);

  const datasetById = useMemo(() => {
    const map = new Map<string, Dataset>();
    datasets.forEach((dataset) => map.set(dataset.id, dataset));
    return map;
  }, [datasets]);

  const activeJobs = jobs.filter((job) => ACTIVE_STATES.includes(job.status));
  const completedJobs = jobs.filter((job) => job.status === 'COMPLETED');
  const approvedModels = models.filter((model) => model.status === 'APPROVED');

  const latestModel = useMemo(
    () =>
      models.find(
        (model) =>
          (model.metricsSummary?.testAccuracy ?? model.metricsSummary?.accuracy) != null ||
          model.metricsSummary?.r2Score != null,
      ) || null,
    [models],
  );

  const latestAccuracy = useMemo(() => {
    const metrics = latestModel?.metricsSummary;
    if (!metrics) return null;
    if (metrics.task === 'regression' || metrics.r2Score != null) {
      return metrics.r2Score != null ? formatMetric(metrics.r2Score) : null;
    }
    const value = metrics.testAccuracy ?? metrics.accuracy;
    return value != null ? formatPercent(value) : null;
  }, [latestModel]);

  const kpis = [
    {
      label: 'Arquitecturas',
      value: formatNumber(architectures.length),
      icon: Cpu,
      detail: `${architectures.filter((arch) => arch.family === 'FEEDFORWARD').length} feedforward`,
      subtext: 'Diseñadas',
    },
    {
      label: 'Conjuntos de datos',
      value: formatNumber(datasets.length),
      icon: Database,
      detail: `${formatNumber(datasets.reduce((sum, dataset) => sum + (dataset.metadata.samples || 0), 0))} muestras`,
      subtext: 'Registrados',
    },
    {
      label: 'Entrenamientos',
      value: formatNumber(jobs.length),
      icon: PlayCircle,
      detail: `${activeJobs.length} activo(s) · ${completedJobs.length} completado(s)`,
      subtext: 'Historial',
    },
    {
      label: 'Versiones de modelo',
      value: formatNumber(models.length),
      icon: Box,
      detail: latestAccuracy ? `Último: ${latestAccuracy}` : `${approvedModels.length} aprobada(s)`,
      subtext: approvedModels.length ? 'Aprobadas' : 'Registro',
    },
  ];

  const recentJobs = jobs.slice(0, 6);
  const recentModels = models.slice(0, 4);
  const recentAudit = auditEvents.slice(0, 6);

  if (projectsLoading && !activeProject) {
    return (
      <div className="space-y-4 animate-in fade-in duration-200">
        <DashboardHeader onRefresh={handleRefresh} refreshing={refreshing} disabled />
        <LoadingBlock label="Cargando espacio de trabajo…" />
      </div>
    );
  }

  if (!activeProject) {
    return (
      <div className="space-y-4 animate-in fade-in duration-200">
        <DashboardHeader onRefresh={handleRefresh} refreshing={refreshing} />
        {projectsError && <ErrorBlock message={projectsError} onRetry={handleRefresh} />}
        <ProjectRequired action="Cree o seleccione un proyecto para ver su estado real de arquitecturas, conjuntos de datos, entrenamientos y modelos." />
        <div className="flex justify-center">
          <button
            onClick={() => onNavigate('projects')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl glass-btn-primary text-xs font-semibold"
          >
            <FolderGit2 className="w-4 h-4" /> Ir a Proyectos
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="glass-card p-6 sm:p-7 rounded-3xl relative overflow-hidden space-y-4 border border-rose-500/15">
        <div className="absolute -right-24 -top-24 w-96 h-96 rounded-full bg-rose-600/10 dark:bg-rose-600/15 blur-3xl pointer-events-none" />
        <div className="flex flex-wrap items-center gap-2 relative z-10">
          <span className="text-xs uppercase font-mono tracking-wider px-2.5 py-1 rounded-full bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30 shadow-[0_0_8px_rgba(225,29,72,0.2)]">
            Proyecto: {activeProject.name}
          </span>
          <span className="text-xs uppercase font-mono tracking-wider px-2.5 py-1 rounded-full bg-black/5 dark:bg-white/10 text-zinc-700 dark:text-white/80 border border-black/10 dark:border-white/10">
            Rol: {labelFor(ROLE_LABELS, activeProject.effectiveRole || currentRole)}
          </span>
          <span className="text-xs uppercase font-mono tracking-wider px-2.5 py-1 rounded-full bg-black/5 dark:bg-white/10 text-zinc-700 dark:text-white/80 border border-black/10 dark:border-white/10">
            Estado: {labelFor(PROJECT_STATUS_LABELS, activeProject.status)}
          </span>
          <span className="text-xs text-zinc-600 dark:text-white/65 font-mono">
            Espacio de trabajo activo
          </span>
        </div>

        <div className="space-y-1.5 max-w-3xl">
          <h1 className="text-2xl sm:text-3xl font-semibold text-zinc-900 dark:text-white tracking-tight">
            {activeProject.name}
          </h1>
          <p className="text-xs text-zinc-600 dark:text-white/60 leading-relaxed">
            {activeProject.description || 'Sin descripción registrada para este proyecto.'}
          </p>
          <p className="text-xs text-zinc-500 dark:text-white/65 font-mono">
            {projects.length} proyecto(s) accesibles · usuario {user?.displayName || user?.email || '—'} · creado{' '}
            {formatDateTime(activeProject.createdAt)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 pt-2">
          <button
            onClick={() => onNavigate('training')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl glass-btn-primary text-xs font-semibold"
          >
            <PlayCircle className="w-4 h-4" /> Abrir Orquestador
          </button>
          <button
            onClick={() => onNavigate('architectures')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl glass-btn-secondary text-xs font-medium"
          >
            <Cpu className="w-4 h-4 text-zinc-600 dark:text-white/70" /> Diseñar Arquitectura
          </button>
          <button
            onClick={() => onNavigate('datasets')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl glass-btn-secondary text-xs font-medium"
          >
            <Database className="w-4 h-4 text-zinc-600 dark:text-white/70" /> Cargar conjunto de datos
          </button>
          <button
            onClick={() => setWalkthroughOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl glass-btn-secondary text-xs font-medium"
          >
            <BookOpen className="w-4 h-4 text-zinc-600 dark:text-white/70" /> Guía del flujo real
          </button>
          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 px-3 py-2.5 rounded-xl glass-btn-secondary text-xs font-medium"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Actualizar
          </button>
        </div>
      </div>

      {error && <ErrorBlock message={error} onRetry={() => loadData()} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.label} className="glass-card p-5 rounded-2xl glass-card-hover flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-600 dark:text-white/60">{kpi.label}</span>
                <div className="p-1.5 rounded-xl glass-inset text-rose-400 border border-rose-500/20 shadow-[0_0_8px_rgba(225,29,72,0.15)]">
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-2xl font-bold font-mono text-zinc-900 dark:text-white">{kpi.value}</div>
                <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-white/65 mt-1 gap-2">
                  <span className="truncate">{kpi.detail}</span>
                  <span className="font-mono text-zinc-700 dark:text-white/70 text-xs shrink-0">{kpi.subtext}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {loading && jobs.length === 0 && models.length === 0 && <LoadingBlock label="Cargando actividad del proyecto…" />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <div className="glass-card p-5 rounded-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-zinc-900 dark:text-white/90 flex items-center gap-2 uppercase tracking-wider">
                <Activity className="w-4 h-4 text-zinc-600 dark:text-white/60" /> Trabajos recientes de entrenamiento
              </h2>
              <button
                onClick={() => onNavigate('training')}
                className="text-xs text-zinc-700 dark:text-white/70 hover:text-zinc-900 dark:hover:text-white font-medium flex items-center gap-1 transition-colors"
              >
                <span>Ver todos</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>

            {recentJobs.length === 0 ? (
              <EmptyBlock
                icon={PlayCircle}
                title="Sin trabajos de entrenamiento"
                description="Ejecute un entrenamiento real con arquitectura Feedforward y un conjunto de datos verificado."
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
                      <th className="pb-2.5 font-medium">Creado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/5 dark:divide-white/5">
                    {recentJobs.map((job) => {
                      const architecture = architectureById.get(job.architectureId);
                      const dataset = datasetById.get(job.datasetId);
                      return (
                        <tr key={job.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.04] transition-colors">
                          <td className="py-3 font-mono font-medium text-zinc-900 dark:text-white/90">
                            {shortId(job.id, 10)}
                          </td>
                          <td className="py-3 text-zinc-600 dark:text-white/60 max-w-[160px] truncate">
                            <span className="text-xs font-mono px-2 py-0.5 rounded-full glass-inset text-zinc-700 dark:text-white/80 border border-black/10 dark:border-white/10 mr-1.5">
                              {architecture?.family || '—'}
                            </span>
                            {architecture?.name || 'Arquitectura no disponible'}
                          </td>
                          <td className="py-3 text-zinc-600 dark:text-white/60 max-w-[150px] truncate">
                            {dataset?.name || 'Conjunto de datos no disponible'}
                          </td>
                          <td className="py-3">
                            <StatusPill status={job.status} />
                          </td>
                          <td className="py-3 text-zinc-500 dark:text-white/65 font-mono text-xs whitespace-nowrap">
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

          <div className="glass-card p-5 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-zinc-900 dark:text-white/90 flex items-center gap-2 uppercase tracking-wider">
                <Box className="w-4 h-4 text-zinc-600 dark:text-white/60" /> Versiones de modelo recientes
              </h2>
              <button
                onClick={() => onNavigate('model-registry')}
                className="text-xs text-zinc-700 dark:text-white/70 hover:text-zinc-900 dark:hover:text-white font-medium flex items-center gap-1 transition-colors"
              >
                <span>Registro</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>

            {recentModels.length === 0 ? (
              <EmptyBlock
                icon={Box}
                title="Sin versiones registradas"
                description="Las versiones se crean automáticamente al completar un entrenamiento exitoso."
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {recentModels.map((model) => {
                  const accuracy = model.metricsSummary?.testAccuracy ?? model.metricsSummary?.accuracy;
                  const r2 = model.metricsSummary?.r2Score;
                  return (
                    <button
                      key={model.id}
                      onClick={() => onNavigate('evaluation')}
                      className="text-left p-3.5 glass-inset rounded-xl border border-black/10 dark:border-white/10 hover:bg-black/[0.03] dark:hover:bg-white/[0.05] transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-zinc-900 dark:text-white">
                          {model.version}
                        </span>
                        <span className="text-xs font-mono px-2 py-0.5 rounded-full glass-inset border border-black/10 dark:border-white/10 text-zinc-600 dark:text-white/60">
                          {labelFor(MODEL_STATUS_LABELS, model.status)}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-500 dark:text-white/65 mt-1">
                        {formatDateTime(model.createdAt)}
                      </p>
                      <div className="flex items-center gap-3 mt-2 text-xs font-mono text-zinc-700 dark:text-white/70">
                        {accuracy != null && (
                          <span className="flex items-center gap-1">
                            <TrendingUp className="w-3 h-3" /> {formatPercent(accuracy)}
                          </span>
                        )}
                        {r2 != null && (
                          <span className="flex items-center gap-1">
                            <TrendingUp className="w-3 h-3" /> R² {formatMetric(r2)}
                          </span>
                        )}
                        {accuracy == null && r2 == null && <span>Sin métricas</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="glass-card p-4 rounded-2xl space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-medium text-zinc-900 dark:text-white/90 flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-zinc-600 dark:text-white/70" /> Estado de la plataforma
              </span>
              {system && (
                <span className="text-xs font-mono text-emerald-700 dark:text-emerald-300">
                  {labelFor(SYSTEM_STATUS_LABELS, system.status)}
                </span>
              )}
            </div>

            {!isAdmin && (
              <p className="text-xs text-zinc-500 dark:text-white/65 leading-relaxed">
                El estado detallado de base de datos, Redis y cola está restringido al rol ADMIN.
                Su sesión opera con el rol <strong className="font-mono text-zinc-700 dark:text-white/70">{currentRole}</strong>.
              </p>
            )}

            {isAdmin && systemError && (
              <p className="text-xs text-rose-600 dark:text-rose-300 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {systemError}
              </p>
            )}

            {isAdmin && system && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500 dark:text-white/65">Base de datos</span>
                  <span className="font-mono text-zinc-800 dark:text-white/80">{system.database}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500 dark:text-white/65">Redis</span>
                  <span className="font-mono text-zinc-800 dark:text-white/80">{system.redis}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500 dark:text-white/65">Cola de trabajos</span>
                  <span className="font-mono text-zinc-800 dark:text-white/80">{system.queueBackend}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500 dark:text-white/65">Entorno / versión</span>
                  <span className="font-mono text-zinc-800 dark:text-white/80">
                    {system.environment} · v{system.version}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500 dark:text-white/65">Tiempo activo</span>
                  <span className="font-mono text-zinc-800 dark:text-white/80">
                    {uptimeLabel(system.uptimeSeconds)}
                  </span>
                </div>
                <div className="pt-2 border-t border-black/5 dark:border-white/5 flex flex-wrap gap-1.5">
                  {Object.entries(system.limits).map(([key, value]) => (
                    <span
                      key={key}
                      className="text-xs font-mono px-1.5 py-0.5 rounded-full glass-inset border border-black/10 dark:border-white/10 text-zinc-600 dark:text-white/60"
                    >
                      {key}={value}
                    </span>
                  ))}
                </div>
                <button
                  onClick={() => onNavigate('administration')}
                  className="w-full text-xs text-zinc-700 dark:text-white/70 hover:text-zinc-900 dark:hover:text-white font-medium pt-1 text-left"
                >
                  Abrir Administración →
                </button>
              </div>
            )}

            {isAdmin && !system && !systemError && (
              <p className="text-xs text-zinc-500 dark:text-white/65 flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Consultando estado…
              </p>
            )}
          </div>

          <div className="glass-card p-4 rounded-2xl space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-medium text-zinc-900 dark:text-white/90 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-zinc-600 dark:text-white/70" /> Actividad de auditoría
              </span>
              <button
                onClick={() => onNavigate('reports')}
                className="text-xs text-zinc-600 dark:text-white/60 hover:text-zinc-900 dark:hover:text-white"
              >
                Ver reportes →
              </button>
            </div>

            {recentAudit.length === 0 ? (
              <p className="text-xs text-zinc-500 dark:text-white/65">
                Aún no hay eventos de auditoría registrados en este proyecto.
              </p>
            ) : (
              <ul className="space-y-2">
                {recentAudit.map((event) => (
                  <li key={event.id} className="flex items-start gap-2">
                    <Radio className="w-3 h-3 mt-0.5 text-zinc-400 dark:text-white/65 shrink-0" />
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-zinc-800 dark:text-white/80 truncate">
                        {event.action}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-white/65 truncate">
                        {event.actorName || shortId(event.actorId, 8)} · {formatDateTime(event.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="glass-card p-4 rounded-2xl space-y-2 text-xs">
            <span className="font-medium text-zinc-900 dark:text-white/90 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-zinc-600 dark:text-white/70" /> Flujo MVP verificado
            </span>
            <p className="text-xs text-zinc-500 dark:text-white/65 leading-relaxed">
              Proyecto → arquitectura Feedforward → conjunto de datos CSV validado → entrenamiento TF/Keras real →
              telemetría en vivo → métricas y versión inmutable con SHA-256.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

const DashboardHeader: React.FC<{ onRefresh: () => void; refreshing: boolean; disabled?: boolean }> = ({
  onRefresh,
  refreshing,
  disabled,
}) => (
  <div className="flex items-center justify-between gap-3 pb-2 border-b border-black/10 dark:border-white/10">
    <div>
      <div className="flex items-center gap-2 text-zinc-600 dark:text-white/60 text-xs font-semibold uppercase tracking-wider">
        <Activity className="w-4 h-4 text-zinc-700 dark:text-white/80" /> Módulo 01 • Panel
      </div>
      <h1 className="text-xl sm:text-2xl font-semibold text-zinc-900 dark:text-white mt-1">
        Panel ejecutivo de aprendizaje profundo
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
