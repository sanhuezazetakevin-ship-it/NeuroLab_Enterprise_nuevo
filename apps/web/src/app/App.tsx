import React, { Suspense, lazy, useCallback, useRef, useState } from 'react';
import { Activity, Network } from 'lucide-react';
import { AuthProvider, useAuth } from '../lib/AuthContext';
import { AppProvider, useApp } from '../lib/AppContext';
import { Shell, NavTab } from '../components/layout/Shell';
import { ToastContainer } from '../components/common/ToastContainer';
import { WalkthroughModal } from '../components/common/WalkthroughModal';
import { LoginView } from '../features/auth/LoginView';
import { GuidedTarget, NavigateFn } from '../lib/guidedFlow';

// Las vistas se cargan bajo demanda: el bundle inicial solo incluye login,
// shell y este enrutador. Cada pestaña se descarga la primera vez que se abre.
const DashboardView = lazy(() =>
  import('../features/dashboard/DashboardView').then((m) => ({ default: m.DashboardView })),
);
const ProjectsView = lazy(() =>
  import('../features/projects/ProjectsView').then((m) => ({ default: m.ProjectsView })),
);
const FundamentalsView = lazy(() =>
  import('../features/fundamentals/FundamentalsView').then((m) => ({ default: m.FundamentalsView })),
);
const ArchitectureDesignerView = lazy(() =>
  import('../features/architectures/ArchitectureDesignerView').then((m) => ({
    default: m.ArchitectureDesignerView,
  })),
);
const DatasetsView = lazy(() =>
  import('../features/datasets/DatasetsView').then((m) => ({ default: m.DatasetsView })),
);
const TrainingManagerView = lazy(() =>
  import('../features/training/TrainingManagerView').then((m) => ({
    default: m.TrainingManagerView,
  })),
);
const EvaluationView = lazy(() =>
  import('../features/evaluation/EvaluationView').then((m) => ({ default: m.EvaluationView })),
);
const ModelRegistryView = lazy(() =>
  import('../features/model-registry/ModelRegistryView').then((m) => ({
    default: m.ModelRegistryView,
  })),
);
const ReportsView = lazy(() =>
  import('../features/reports/ReportsView').then((m) => ({ default: m.ReportsView })),
);
const AdministrationView = lazy(() =>
  import('../features/administration/AdministrationView').then((m) => ({
    default: m.AdministrationView,
  })),
);

const LoadingScreen: React.FC = () => (
  <div className="min-h-screen w-full flex items-center justify-center p-6">
    <div className="glass-panel rounded-3xl px-8 py-7 flex items-center gap-4 shadow-glass">
      <div className="w-11 h-11 rounded-2xl bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/20 flex items-center justify-center text-zinc-900 dark:text-white">
        <Network className="w-5 h-5" />
      </div>
      <div>
        <p className="text-sm font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
          NeuroLab Enterprise <Activity className="w-3.5 h-3.5 animate-pulse" />
        </p>
        <p className="text-xs text-zinc-500 dark:text-white/65">
          Verificando sesión y cargando espacio de trabajo…
        </p>
      </div>
    </div>
  </div>
);

const ViewLoading: React.FC = () => (
  <div className="flex items-center justify-center py-20 text-sm text-zinc-500 dark:text-white/65">
    <Activity className="w-4 h-4 animate-pulse mr-2" />
    Cargando vista…
  </div>
);

const MainAppContent: React.FC = () => {
  const { activeProject, setActiveProject } = useApp();
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [guidedTarget, setGuidedTarget] = useState<GuidedTarget | null>(null);
  const guidedSequence = useRef(0);

  const navigate = useCallback<NavigateFn>((tab, target) => {
    if (target) {
      guidedSequence.current += 1;
      setGuidedTarget({ ...target, id: guidedSequence.current });
    } else {
      setGuidedTarget(null);
    }
    setCurrentTab(tab);
  }, []);

  const consumeGuided = useCallback((id: number) => {
    setGuidedTarget((current) => (current?.id === id ? null : current));
  }, []);

  return (
    <Shell currentTab={currentTab} onSelectTab={navigate}>
      <Suspense fallback={<ViewLoading />}>
        {currentTab === 'dashboard' && <DashboardView onNavigate={navigate} />}
        {currentTab === 'projects' && <ProjectsView onNavigate={navigate} />}
        {currentTab === 'fundamentals' && <FundamentalsView />}
        {currentTab === 'architectures' && (
          <ArchitectureDesignerView
            onNavigate={navigate}
            guided={guidedTarget}
            onGuidedConsumed={consumeGuided}
          />
        )}
        {currentTab === 'datasets' && (
          <DatasetsView
            onNavigate={navigate}
            guided={guidedTarget}
            onGuidedConsumed={consumeGuided}
          />
        )}
        {currentTab === 'training' && (
          <TrainingManagerView guided={guidedTarget} onGuidedConsumed={consumeGuided} />
        )}
        {currentTab === 'evaluation' && <EvaluationView />}
        {currentTab === 'model-registry' && <ModelRegistryView />}
        {currentTab === 'reports' && <ReportsView />}
        {currentTab === 'administration' && <AdministrationView />}
      </Suspense>

      {/* Global Overlays */}
      <WalkthroughModal onNavigateTab={navigate} />
      <ToastContainer />
      {activeProject && <span className="sr-only">Proyecto activo: {activeProject.name}</span>}
      {!activeProject && (
        <span className="sr-only">
          Sin proyecto activo. Cree un proyecto o solicite acceso para comenzar.
        </span>
      )}
    </Shell>
  );
};

const AuthenticatedApp: React.FC = () => {
  const { user, loading } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!user) return <LoginView />;

  return (
    <AppProvider>
      <MainAppContent />
    </AppProvider>
  );
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <AuthenticatedApp />
    </AuthProvider>
  );
};

export default App;
