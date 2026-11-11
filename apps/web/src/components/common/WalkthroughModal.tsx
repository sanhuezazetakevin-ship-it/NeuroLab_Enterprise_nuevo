import React, { useState } from 'react';
import {
  X,
  ChevronLeft,
  BookOpen,
  Cpu,
  PlayCircle,
  Box,
  Layers,
  ArrowRight,
  Database,
  FolderGit2,
  Minimize2,
  Maximize2,
} from 'lucide-react';
import { useApp } from '../../lib/AppContext';
import type { NavTab } from '../layout/Shell';

interface WalkthroughModalProps {
  onNavigateTab: (tab: NavTab) => void;
}

export const WalkthroughModal: React.FC<WalkthroughModalProps> = ({ onNavigateTab }) => {
  const { walkthroughOpen, setWalkthroughOpen } = useApp();
  const [currentStep, setCurrentStep] = useState(0);
  const [minimized, setMinimized] = useState(false);

  if (!walkthroughOpen) return null;

  const steps = [
    {
      title: 'NeuroLab Enterprise',
      subtitle: 'Plataforma real para diseñar, entrenar y gobernar redes neuronales',
      icon: Layers,
      badge: 'Visión general',
      content: (
        <div className="space-y-2.5 text-xs text-zinc-700 dark:text-white/70">
          <p>
            Esta instancia opera contra la API <strong>/api/v1</strong>, Supabase (PostgreSQL) y
            workers TensorFlow/Keras aislados. Todos los datos provienen de la base de datos real.
          </p>
          <div className="p-2.5 rounded-xl bg-zinc-50 dark:bg-black/40 space-y-1 border border-zinc-200/80 dark:border-white/10 text-xs">
            <span className="font-semibold text-zinc-900 dark:text-white/90 uppercase tracking-wider block">
              Flujo verificado
            </span>
            <ul className="space-y-0.5 list-disc list-inside text-zinc-600 dark:text-white/60">
              <li>Autenticación JWT y permisos por rol efectivo.</li>
              <li>Entrenamiento asíncrono con telemetría persistida.</li>
              <li>Modelos inmutables con verificación SHA-256.</li>
            </ul>
          </div>
        </div>
      ),
      actionLabel: 'Iniciar recorrido',
      actionTab: null as NavTab | null,
    },
    {
      title: '1. Proyectos y acceso',
      subtitle: 'Espacios aislados con roles y trazabilidad',
      icon: FolderGit2,
      badge: 'Módulo 02',
      content: (
        <div className="space-y-2.5 text-xs text-zinc-700 dark:text-white/70">
          <p>
            Cree un proyecto con nombre, descripción y tipo de red. Al guardarlo, la app abre
            automáticamente la carga del CSV para continuar el flujo.
          </p>
          <div className="p-2.5 rounded-xl bg-zinc-50 dark:bg-black/40 border border-zinc-200/80 dark:border-white/10 text-zinc-800 dark:text-white/80 text-xs">
            El rol efectivo determina sus permisos: <strong>Lector</strong> y{' '}
            <strong>Revisor</strong> consultan; <strong>Ingeniero de IA</strong> y{' '}
            <strong>Administrador</strong> crean y entrenan.
          </div>
        </div>
      ),
      actionLabel: 'Ir a Proyectos',
      actionTab: 'projects' as NavTab,
    },
    {
      title: '2. Conjuntos de datos verificados',
      subtitle: 'Validación de esquema, columna objetivo y checksum',
      icon: Database,
      badge: 'Módulo 05',
      content: (
        <div className="space-y-2.5 text-xs text-zinc-700 dark:text-white/70">
          <p>
            Cargue su archivo CSV indicando la columna objetivo. El servidor valida tipos,
            partición determinista 70/15/15 y genera checksum SHA-256. Al terminar, la app abre el
            diseñador con ese dataset ya seleccionado.
          </p>
          <div className="p-2.5 rounded-xl bg-zinc-50 dark:bg-black/40 border border-zinc-200/80 dark:border-white/10 text-zinc-800 dark:text-white/80 text-xs">
            La partición previene la fuga de datos al calcular escaladores y medias solo con Train.
          </div>
        </div>
      ),
      actionLabel: 'Ir a Conjuntos de datos',
      actionTab: 'datasets' as NavTab,
    },
    {
      title: '3. Fundamentos y diseñador',
      subtitle: 'Topologías neuronales y validación dimensional',
      icon: Cpu,
      badge: 'Módulos 03–04',
      content: (
        <div className="space-y-2.5 text-xs text-zinc-700 dark:text-white/70">
          <p>
            Diseñe y configure su red neuronal. La API valida las dimensiones de tensores y la
            compatibilidad de capas en tiempo real antes de guardar. Al guardar, la app lleva a
            Entrenamientos con la arquitectura y el dataset preseleccionados.
          </p>
          <div className="p-2.5 rounded-xl bg-zinc-50 dark:bg-black/40 border border-zinc-200/80 dark:border-white/10 text-zinc-800 dark:text-white/80 text-xs">
            Entrenamiento habilitado para arquitecturas <strong>Feedforward (MLP)</strong>,{' '}
            <strong>RNN (LSTM/GRU)</strong> y <strong>CNN (1D)</strong> con workers aislados.
          </div>
        </div>
      ),
      actionLabel: 'Ir al Diseñador',
      actionTab: 'architectures' as NavTab,
    },
    {
      title: '4. Entrenamiento y telemetría',
      subtitle: 'Cola de trabajos, worker Keras y SSE con replay',
      icon: PlayCircle,
      badge: 'Módulo 06',
      content: (
        <div className="space-y-2.5 text-xs text-zinc-700 dark:text-white/70">
          <p>
            Lance trabajos asíncronos y supervise la curva de pérdida y exactitud en tiempo real
            vía Server-Sent Events con reconexión automática.
          </p>
          <div className="p-2.5 rounded-xl bg-zinc-50 dark:bg-black/40 border border-zinc-200/80 dark:border-white/10 text-zinc-800 dark:text-white/80 text-xs">
            Si cierra el navegador, el entrenamiento continúa y se recupera desde Supabase.
          </div>
        </div>
      ),
      actionLabel: 'Ir a Entrenamientos',
      actionTab: 'training' as NavTab,
    },
    {
      title: '5. Evaluación y registro',
      subtitle: 'Métricas, matriz de confusión e inferencia en lote',
      icon: Box,
      badge: 'Módulos 07–09',
      content: (
        <div className="space-y-2.5 text-xs text-zinc-700 dark:text-white/70">
          <p>
            Inspeccione la matriz de confusión térmica, compare versiones, apruebe modelos
            para producción y ejecute predicciones individuales o por archivo CSV.
          </p>
          <div className="p-2.5 rounded-xl bg-zinc-50 dark:bg-black/40 border border-zinc-200/80 dark:border-white/10 text-zinc-800 dark:text-white/80 text-xs">
            Descargue artefactos <code>.keras</code> y use fragmentos de código cURL, Python y Node.js.
          </div>
        </div>
      ),
      actionLabel: 'Ir al Registro',
      actionTab: 'model-registry' as NavTab,
    },
    {
      title: 'Fundamentos interactivos',
      subtitle: 'Simulador del perceptrón y telemetría matemática',
      icon: BookOpen,
      badge: 'Módulo 03',
      content: (
        <div className="space-y-2.5 text-xs text-zinc-700 dark:text-white/70">
          <p>
            Ajuste pesos, sesgo y funciones de activación para visualizar el grafo sináptico, la
            curva de activación, la frontera de decisión 2D y el gradiente $f'(z)$.
          </p>
          <div className="p-2.5 rounded-xl bg-zinc-50 dark:bg-black/40 border border-zinc-200/80 dark:border-white/10 text-zinc-800 dark:text-white/80 text-xs">
            Todos los cálculos se actualizan reactivamente en tiempo real.
          </div>
        </div>
      ),
      actionLabel: 'Ir a Fundamentos',
      actionTab: 'fundamentals' as NavTab,
    },
  ];

  const step = steps[currentStep];
  const Icon = step.icon;

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      setWalkthroughOpen(false);
      setCurrentStep(0);
    }
  };

  const handleAction = () => {
    if (step.actionTab) onNavigateTab(step.actionTab);
    handleNext();
  };

  // Minimized floating pill
  if (minimized) {
    return (
      <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 p-2.5 rounded-2xl bg-white dark:bg-[#0c0d14] border border-zinc-200 dark:border-rose-500/30 shadow-2xl animate-in slide-in-from-bottom-2 duration-150 select-none">
        <div className="p-1.5 rounded-xl bg-rose-500/10 text-rose-500">
          <Icon className="w-4 h-4" />
        </div>
        <div className="text-xs pr-1">
          <p className="font-semibold text-zinc-900 dark:text-white leading-tight">
            Guía · Paso {currentStep + 1}/{steps.length}
          </p>
          <p className="text-xs text-zinc-500 dark:text-white/65 truncate max-w-[160px]">
            {step.title}
          </p>
        </div>
        <button
          onClick={() => setMinimized(false)}
          className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/10 text-zinc-600 dark:text-white/70 hover:text-zinc-900 dark:hover:text-white transition-colors"
          title="Expandir guía"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setWalkthroughOpen(false)}
          className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/10 text-zinc-400 hover:text-zinc-700 dark:hover:text-white transition-colors"
          title="Cerrar guía"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  // Expanded floating coachmark card (no full-screen backdrop so user sees the app!)
  return (
    <div className="fixed bottom-5 right-5 z-50 w-[380px] max-w-[calc(100vw-2.5rem)] bg-white dark:bg-[#0c0d14] rounded-2xl p-4 sm:p-5 shadow-2xl border border-zinc-200 dark:border-rose-500/30 space-y-3.5 animate-in slide-in-from-bottom-3 duration-200">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1 rounded-full transition-all duration-300 ${
                i === currentStep
                  ? 'w-5 bg-rose-500 shadow-[0_0_6px_#f43f5e]'
                  : 'w-1.5 bg-zinc-300 dark:bg-white/20'
              }`}
            />
          ))}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setMinimized(true)}
            className="p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/10 text-zinc-400 hover:text-zinc-700 dark:hover:text-white transition-colors"
            title="Minimizar a pestaña pequeña"
          >
            <Minimize2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setWalkthroughOpen(false)}
            className="p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/10 text-zinc-400 hover:text-zinc-700 dark:hover:text-white transition-colors"
            title="Cerrar guía"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex items-start gap-2.5">
        <div className="p-2 rounded-xl bg-rose-500/10 text-rose-500 border border-rose-500/20 shrink-0">
          <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-300 font-semibold border border-rose-500/20">
              {step.badge}
            </span>
            <span className="text-xs text-zinc-500 dark:text-white/65">
              Paso {currentStep + 1} de {steps.length}
            </span>
          </div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white mt-1 leading-snug">
            {step.title}
          </h2>
          <p className="text-xs text-zinc-500 dark:text-white/65">{step.subtitle}</p>
        </div>
      </div>

      <div className="text-xs">{step.content}</div>

      <div className="flex items-center justify-between pt-2.5 border-t border-zinc-100 dark:border-white/10">
        <button
          onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
          disabled={currentStep === 0}
          className={`flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors ${
            currentStep === 0
              ? 'opacity-30 cursor-not-allowed text-zinc-400 dark:text-white/65'
              : 'text-zinc-700 dark:text-white/70 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/10'
          }`}
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Anterior
        </button>

        <button
          onClick={handleAction}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl glass-btn-primary text-xs font-semibold"
        >
          <span>{step.actionLabel}</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
