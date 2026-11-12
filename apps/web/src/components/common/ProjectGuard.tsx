import React from 'react';
import { AlertTriangle, FolderGit2, RefreshCw } from 'lucide-react';

export const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`skeleton ${className}`} aria-hidden="true" />
);

export const ProjectRequired: React.FC<{ action?: string }> = ({ action }) => (
  <div
    className="glass-card rounded-2xl p-8 flex flex-col items-center justify-center text-center gap-3 min-h-[260px]"
    role="status"
    aria-live="polite"
  >
    <div className="w-12 h-12 rounded-2xl glass-inset flex items-center justify-center text-zinc-600 dark:text-white/70">
      <FolderGit2 className="w-5 h-5" aria-hidden="true" />
    </div>
    <div>
      <h3 className="text-base font-semibold text-zinc-900 dark:text-white">No hay proyecto activo</h3>
      <p className="text-sm text-zinc-600 dark:text-white/70 mt-1 max-w-md">
        {action || 'Seleccione o cree un proyecto en el módulo Proyectos para continuar.'}
      </p>
    </div>
  </div>
);

interface ProjectRequiredPageProps {
  icon: React.ElementType;
  eyebrow: React.ReactNode;
  title: string;
  description: string;
  action: string;
}

export const ProjectRequiredPage: React.FC<ProjectRequiredPageProps> = ({
  icon: Icon,
  eyebrow,
  title,
  description,
  action,
}) => (
  <div className="space-y-4 animate-in fade-in duration-200">
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-black/10 dark:border-white/10">
      <div>
        <div className="flex items-center gap-2 text-zinc-600 dark:text-white/60 text-xs font-semibold uppercase tracking-wider">
          <Icon className="w-4 h-4 text-zinc-700 dark:text-white/80" /> {eyebrow}
        </div>
        <h1 className="text-xl sm:text-2xl font-semibold text-zinc-900 dark:text-white mt-1">{title}</h1>
        <p className="text-xs text-zinc-500 dark:text-white/65 mt-0.5">{description}</p>
      </div>
    </div>
    <ProjectRequired action={action} />
  </div>
);

export const LoadingBlock: React.FC<{ label?: string }> = ({ label = 'Cargando datos…' }) => (
  <div
    className="glass-card rounded-2xl p-6 min-h-[180px]"
    role="status"
    aria-live="polite"
    aria-busy="true"
  >
    <span className="sr-only">{label}</span>
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-4 w-40 max-w-[45%]" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-20" />
        ))}
      </div>
      <Skeleton className="h-24 w-full" />
      <p className="text-xs text-zinc-600 dark:text-white/65 text-center pt-1">{label}</p>
    </div>
  </div>
);

export const ErrorBlock: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div
    className="glass-card rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-rose-500/30"
    role="alert"
    aria-live="assertive"
  >
    <div className="flex items-start gap-2.5 text-sm text-rose-700 dark:text-rose-300">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
    {onRetry && (
      <button
        onClick={onRetry}
        className="flex items-center gap-1.5 px-3 py-2 rounded-xl glass-btn-secondary text-sm font-medium shrink-0 self-start sm:self-auto"
      >
        <RefreshCw className="w-4 h-4" /> Reintentar
      </button>
    )}
  </div>
);

interface EmptyBlockProps {
  title: string;
  description?: string;
  icon?: React.ElementType;
  actionLabel?: string;
  onAction?: () => void;
}

export const EmptyBlock: React.FC<EmptyBlockProps> = ({
  title,
  description,
  icon: Icon,
  actionLabel,
  onAction,
}) => (
  <div className="glass-inset rounded-2xl p-8 flex flex-col items-center justify-center text-center gap-2">
    {Icon && <Icon className="w-5 h-5 text-zinc-500 dark:text-white/60" aria-hidden="true" />}
    <p className="text-sm font-semibold text-zinc-800 dark:text-white/85">{title}</p>
    {description && (
      <p className="text-sm text-zinc-600 dark:text-white/65 max-w-md leading-relaxed">{description}</p>
    )}
    {actionLabel && onAction && (
      <button
        onClick={onAction}
        className="mt-1 px-3.5 py-2 rounded-xl glass-btn-primary text-sm font-semibold"
      >
        {actionLabel}
      </button>
    )}
  </div>
);
