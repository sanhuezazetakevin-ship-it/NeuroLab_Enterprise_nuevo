import React from 'react';
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from 'lucide-react';
import { useApp } from '../../lib/AppContext';

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useApp();

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm w-[calc(100%-2.5rem)] pointer-events-none"
      aria-label="Notificaciones del sistema"
    >
      {toasts.map((toast) => {
        let Icon = CheckCircle2;
        let toneClass = 'border-emerald-500/35 text-emerald-700 dark:text-emerald-300';
        let iconColor = 'text-emerald-600 dark:text-emerald-400';

        if (toast.type === 'warning') {
          Icon = AlertTriangle;
          toneClass = 'border-amber-500/35 text-amber-700 dark:text-amber-300';
          iconColor = 'text-amber-600 dark:text-amber-400';
        } else if (toast.type === 'error') {
          Icon = XCircle;
          toneClass = 'border-rose-500/35 text-rose-700 dark:text-rose-300';
          iconColor = 'text-rose-600 dark:text-rose-400';
        } else if (toast.type === 'info') {
          Icon = Info;
          toneClass = 'border-sky-500/35 text-sky-700 dark:text-sky-300';
          iconColor = 'text-sky-600 dark:text-sky-400';
        }

        const isError = toast.type === 'error';

        return (
          <div
            key={toast.id}
            role={isError ? 'alert' : 'status'}
            aria-live={isError ? 'assertive' : 'polite'}
            aria-atomic="true"
            className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-2xl glass-panel shadow-glass border animate-in slide-in-from-right-5 fade-in duration-200 ${toneClass}`}
          >
            <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${iconColor}`} aria-hidden="true" />
            <div className="flex-1 text-sm text-zinc-900 dark:text-white leading-snug font-medium">
              {toast.message}
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-zinc-500 dark:text-white/65 hover:text-zinc-900 dark:hover:text-white transition-colors p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
              aria-label="Cerrar notificación"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
