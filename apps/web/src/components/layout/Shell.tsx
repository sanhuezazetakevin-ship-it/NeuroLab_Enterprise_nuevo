import React, { useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard,
  FolderGit2,
  BookOpen,
  Cpu,
  Database,
  PlayCircle,
  LineChart,
  Box,
  FileSpreadsheet,
  ShieldCheck,
  ChevronRight,
  Layers,
  Activity,
  CheckCircle2,
  Menu,
  UserCheck,
  HelpCircle,
  Sun,
  Moon,
  Network,
  RefreshCw,
  LogOut,
  UserCircle2,
  X,
  ArrowRight,
} from 'lucide-react';
import { useApp } from '../../lib/AppContext';
import { useAuth } from '../../lib/AuthContext';
import {
  PROJECT_STATUS_LABELS,
  ROLE_LABELS,
  labelFor,
} from '../../lib/labels';
import { Project } from '../../types';

export type NavTab =
  | 'dashboard'
  | 'projects'
  | 'fundamentals'
  | 'architectures'
  | 'datasets'
  | 'training'
  | 'evaluation'
  | 'model-registry'
  | 'reports'
  | 'administration';

interface ShellProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  children: React.ReactNode;
}

interface NavEntry {
  id: NavTab;
  label: string;
  icon: React.ElementType;
  adminOnly?: boolean;
}

interface NavGroup {
  title: string;
  entries: NavEntry[];
}

const DASHBOARD_ENTRY: NavEntry = {
  id: 'dashboard',
  label: 'Panel general',
  icon: LayoutDashboard,
};

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Preparar',
    entries: [
      { id: 'projects', label: 'Proyectos', icon: FolderGit2 },
      { id: 'datasets', label: 'Conjuntos de datos', icon: Database },
    ],
  },
  {
    title: 'Diseñar',
    entries: [
      { id: 'fundamentals', label: 'Fundamentos', icon: BookOpen },
      { id: 'architectures', label: 'Diseñador de redes', icon: Cpu },
    ],
  },
  {
    title: 'Entrenar',
    entries: [
      { id: 'training', label: 'Entrenamientos', icon: PlayCircle },
    ],
  },
  {
    title: 'Evaluar y publicar',
    entries: [
      { id: 'evaluation', label: 'Evaluación y métricas', icon: LineChart },
      { id: 'model-registry', label: 'Registro de modelos', icon: Box },
      { id: 'reports', label: 'Ficha técnica', icon: FileSpreadsheet },
    ],
  },
  {
    title: 'Sistema',
    entries: [
      { id: 'administration', label: 'Administración', icon: ShieldCheck, adminOnly: true },
    ],
  },
];

function nextStepFor(project: Project | null): {
  label: string;
  detail: string;
  tab: NavTab;
} {
  if (!project) {
    return {
      label: 'Cree o seleccione un proyecto',
      detail: 'Aún no hay un espacio de trabajo activo.',
      tab: 'projects',
    };
  }
  if (!project.datasetsCount) {
    return {
      label: 'Suba el primer conjunto de datos',
      detail: 'Un CSV validado habilita el entrenamiento real.',
      tab: 'datasets',
    };
  }
  if (!project.architecturesCount) {
    return {
      label: 'Diseñe la primera arquitectura',
      detail: 'Configure las capas y guárdela para entrenar.',
      tab: 'architectures',
    };
  }
  if (!project.jobsCount) {
    return {
      label: 'Ejecute el primer entrenamiento',
      detail: 'El worker procesará el trabajo en segundo plano.',
      tab: 'training',
    };
  }
  return {
    label: 'Revise la evaluación del modelo',
    detail: 'Compare métricas y publique la versión.',
    tab: 'evaluation',
  };
}

export const Shell: React.FC<ShellProps> = ({ currentTab, onSelectTab, children }) => {
  const {
    theme,
    toggleTheme,
    currentRole,
    activeProject,
    setActiveProject,
    projects,
    refreshProjects,
    projectsLoading,
    projectsError,
    setWalkthroughOpen,
  } = useApp();
  const { user, logout } = useAuth();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const nextStep = useMemo(() => nextStepFor(activeProject), [activeProject]);

  useEffect(() => {
    if (!mobileOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileOpen]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshProjects();
    setRefreshing(false);
  };

  const handleSelectProject = (project: Project) => {
    setActiveProject(project);
    setShowProjectMenu(false);
  };

  const selectTab = (tab: NavTab) => {
    onSelectTab(tab);
    setMobileOpen(false);
    setShowProjectMenu(false);
    setShowUserMenu(false);
  };

  const renderNavEntry = (entry: NavEntry, compact: boolean) => {
    const Icon = entry.icon;
    const isActive = currentTab === entry.id;
    return (
      <button
        key={entry.id}
        onClick={() => selectTab(entry.id)}
        aria-current={isActive ? 'page' : undefined}
        title={compact ? entry.label : undefined}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
          isActive
            ? 'bg-rose-50 text-rose-700 border border-rose-200 shadow-sm dark:bg-gradient-to-r dark:from-rose-950/70 dark:via-rose-900/40 dark:to-rose-950/20 dark:text-white dark:border-rose-500/40 dark:shadow-[0_0_15px_rgba(225,29,72,0.25)] font-semibold'
            : 'text-zinc-700 dark:text-white/70 hover:text-zinc-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-rose-950/20 border border-transparent'
        } ${compact ? 'justify-center px-0' : ''}`}
      >
        <Icon
          className={`w-[18px] h-[18px] shrink-0 transition-transform duration-200 ${
            isActive
              ? 'text-rose-600 dark:text-rose-400 drop-shadow-sm dark:drop-shadow-[0_0_8px_rgba(244,63,94,0.7)] scale-105'
              : 'text-zinc-500 dark:text-white/65'
          }`}
        />
        {!compact && <span className="flex-1 text-left truncate">{entry.label}</span>}
      </button>
    );
  };

  const renderSidebarContent = (compact: boolean, mobile = false) => {
    const visibleGroups = NAV_GROUPS.map((group) => ({
      ...group,
      entries: group.entries.filter((entry) => !entry.adminOnly || currentRole === 'ADMIN'),
    })).filter((group) => group.entries.length > 0);

    return (
      <>
        <div className="h-16 flex items-center justify-between px-4 border-b border-black/10 dark:border-white/10 shrink-0">
          {!compact && (
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-rose-50 dark:bg-rose-500/20 flex items-center justify-center text-rose-600 dark:text-rose-500 border border-rose-200 dark:border-rose-500/30 shadow-sm dark:shadow-[0_0_12px_rgba(225,29,72,0.3)] shrink-0">
                <Network className="w-[18px] h-[18px] text-rose-600 dark:text-rose-500 drop-shadow-sm dark:drop-shadow-[0_0_6px_rgba(244,63,94,0.8)]" />
              </div>
              <div className="min-w-0">
                <span className="font-semibold tracking-tight text-zinc-900 dark:text-white flex items-center gap-1.5 text-sm">
                  NeuroLab{' '}
                  <span className="text-2xs uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30 font-mono">
                    Enterprise
                  </span>
                </span>
                <p className="text-2xs text-zinc-600 dark:text-white/65 font-medium truncate">
                  Plataforma de aprendizaje profundo
                </p>
              </div>
            </div>
          )}

          {compact && (
            <div className="w-9 h-9 mx-auto rounded-xl bg-rose-50 dark:bg-rose-500/20 flex items-center justify-center text-rose-600 dark:text-rose-500 border border-rose-200 dark:border-rose-500/30 shadow-sm dark:shadow-[0_0_12px_rgba(225,29,72,0.3)]">
              <Network className="w-[18px] h-[18px] text-rose-600 dark:text-rose-500" />
            </div>
          )}

          {mobile ? (
            <button
              onClick={() => setMobileOpen(false)}
              className="p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 text-zinc-600 dark:text-white/70 hover:text-zinc-900 dark:hover:text-white transition-colors"
              aria-label="Cerrar menú de navegación"
            >
              <X className="w-5 h-5" />
            </button>
          ) : (
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 text-zinc-600 dark:text-white/65 hover:text-zinc-900 dark:hover:text-white transition-colors"
              aria-label={collapsed ? 'Expandir menú lateral' : 'Colapsar menú lateral'}
              aria-expanded={!collapsed}
            >
              <ChevronRight className={`w-4 h-4 transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`} />
            </button>
          )}
        </div>

        <nav className="flex-1 py-3 px-2.5 overflow-y-auto space-y-4" aria-label="Navegación principal">
          <div className="space-y-1">{renderNavEntry(DASHBOARD_ENTRY, compact)}</div>

          {visibleGroups.map((group) => (
            <div key={group.title} className="space-y-1">
              {!compact && (
                <p className="px-3 pt-1 pb-1 text-2xs font-semibold uppercase tracking-[0.14em] text-zinc-600 dark:text-white/65">
                  {group.title}
                </p>
              )}
              {group.entries.map((entry) => renderNavEntry(entry, compact))}
            </div>
          ))}
        </nav>

        {!compact && (
          <div className="px-3 pb-2">
            <button
              onClick={() => selectTab(nextStep.tab)}
              className="w-full p-3 rounded-xl glass-inset hover:border-rose-500/30 flex flex-col gap-1 transition-all text-left group"
            >
              <span className="text-2xs uppercase tracking-wider text-zinc-600 dark:text-white/65 font-semibold flex items-center gap-1.5">
                <ArrowRight className="w-3 h-3 text-emerald-500" /> Siguiente paso
              </span>
              <span className="text-sm font-semibold text-zinc-900 dark:text-white leading-snug">
                {nextStep.label}
              </span>
              <span className="text-2xs text-zinc-600 dark:text-white/65 leading-snug">
                {nextStep.detail}
              </span>
            </button>
          </div>
        )}

        {!compact && (
          <div className="px-3 pb-2">
            <button
              onClick={() => {
                setWalkthroughOpen(true);
                setMobileOpen(false);
              }}
              className="w-full p-2.5 rounded-xl glass-inset hover:border-rose-500/30 flex items-center gap-2.5 transition-all text-left group"
            >
              <div className="p-1 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
                <HelpCircle className="w-3.5 h-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-zinc-900 dark:text-white/90 leading-none">Guía de cliente</p>
                <p className="text-2xs text-zinc-600 dark:text-white/65 truncate mt-1">Flujo real de la plataforma</p>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-zinc-500 dark:text-white/60 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
        )}

        <div className="p-3 border-t border-black/10 dark:border-white/10 shrink-0">
          {!compact ? (
            <div className="p-2.5 rounded-xl glass-inset flex items-center justify-between text-xs border border-emerald-500/20">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 shadow-[0_0_10px_#10b981]" />
                </span>
                <div>
                  <p className="font-medium text-zinc-900 dark:text-white/90 leading-none">Worker Keras</p>
                  <p className="text-2xs text-zinc-600 dark:text-white/65 mt-1">Telemetría asíncrona</p>
                </div>
              </div>
              <Activity className="w-3.5 h-3.5 text-emerald-500/80" aria-hidden="true" />
            </div>
          ) : (
            <div className="flex justify-center" title="Worker de entrenamiento asíncrono">
              <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 shadow-[0_0_10px_#10b981]" />
              </span>
            </div>
          )}
        </div>
      </>
    );
  };

  return (
    <div className="flex h-screen w-full overflow-hidden p-2 sm:p-3 gap-2 sm:gap-3">
      {/* SIDEBAR ESCRITORIO */}
      <aside
        className={`${
          collapsed ? 'w-20' : 'w-64'
        } transition-all duration-300 ease-out glass-panel rounded-2xl hidden lg:flex flex-col z-30 select-none shrink-0 shadow-glass`}
        aria-label="Barra lateral"
      >
        {renderSidebarContent(collapsed)}
      </aside>

      {/* DRAWER MÓVIL */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside
            className="relative h-full w-72 max-w-[85vw] glass-panel rounded-r-2xl flex flex-col shadow-2xl animate-in slide-in-from-left duration-200"
            role="dialog"
            aria-modal="true"
            aria-label="Menú de navegación"
          >
            {renderSidebarContent(false, true)}
          </aside>
        </div>
      )}

      {/* ÁREA PRINCIPAL */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden gap-2 sm:gap-3">
        <header className="glass-panel rounded-2xl h-14 px-3 sm:px-5 flex items-center justify-between z-20 shrink-0 shadow-glass gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 rounded-xl glass-inset text-zinc-700 dark:text-white/70 hover:text-zinc-900 dark:hover:text-white transition-colors shrink-0"
              aria-label="Abrir menú de navegación"
              aria-expanded={mobileOpen}
            >
              <Menu className="w-4 h-4" />
            </button>

            <div className="relative min-w-0">
              <button
                onClick={() => setShowProjectMenu((value) => !value)}
                className="flex items-center gap-2 px-2.5 sm:px-3 py-1.5 rounded-xl glass-inset hover:bg-black/5 dark:hover:bg-white/[0.08] border border-black/10 dark:border-white/10 text-xs sm:text-sm font-medium text-zinc-900 dark:text-white/90 transition-colors max-w-[190px] sm:max-w-[280px]"
                aria-label="Seleccionar proyecto activo"
                aria-haspopup="menu"
                aria-expanded={showProjectMenu}
              >
                <Layers className="w-4 h-4 text-zinc-600 dark:text-white/70 shrink-0" />
                <span className="truncate">
                  {activeProject ? activeProject.name : projectsLoading ? 'Cargando proyectos…' : 'Sin proyecto activo'}
                </span>
                <ChevronRight className="w-3 h-3 text-zinc-500 dark:text-white/60 rotate-90 ml-0.5 shrink-0" />
              </button>

              {showProjectMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowProjectMenu(false)}
                    aria-hidden="true"
                  />
                  <div
                    className="absolute left-0 mt-2 w-[min(22rem,calc(100vw-2rem))] bg-white dark:bg-[#0c0d14] rounded-2xl p-2.5 z-50 shadow-2xl border border-zinc-200 dark:border-rose-500/30 animate-in fade-in zoom-in-95"
                    role="menu"
                    aria-label="Proyectos disponibles"
                  >
                    <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-100 dark:border-white/10 mb-1">
                      <span className="text-2xs font-bold text-zinc-600 dark:text-white/65 uppercase tracking-wider">
                        Proyecto activo
                      </span>
                      <button
                        onClick={handleRefresh}
                        className="p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/10 text-zinc-600 dark:text-white/65 transition-colors"
                        aria-label="Actualizar lista de proyectos"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                      </button>
                    </div>

                    {projects.length === 0 && (
                      <p className="px-3 py-3 text-sm text-zinc-600 dark:text-white/65">
                        No tiene proyectos asignados todavía.
                      </p>
                    )}

                    <div className="max-h-64 overflow-y-auto space-y-1 py-1">
                      {projects.map((project) => {
                        const isSelected = project.id === activeProject?.id;
                        return (
                          <button
                            key={project.id}
                            onClick={() => handleSelectProject(project)}
                            role="menuitem"
                            className={`w-full text-left px-3 py-2 rounded-xl text-sm transition-all flex items-center justify-between gap-2.5 ${
                              isSelected
                                ? 'bg-rose-500/10 text-zinc-900 dark:text-rose-200 font-semibold border border-rose-500/30 shadow-sm'
                                : 'text-zinc-700 dark:text-white/70 hover:bg-zinc-100 dark:hover:bg-white/[0.08] hover:text-zinc-900 dark:hover:text-white'
                            }`}
                          >
                            <span className="truncate flex-1 font-medium">{project.name}</span>
                            <span className="text-2xs font-mono px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-white/65 shrink-0 border border-zinc-200/60 dark:border-white/10">
                              {project.effectiveRole
                                ? labelFor(ROLE_LABELS, project.effectiveRole)
                                : labelFor(PROJECT_STATUS_LABELS, project.status)}
                            </span>
                            {isSelected && (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    <div className="border-t border-zinc-100 dark:border-white/10 mt-1.5 pt-1.5">
                      <button
                        onClick={() => selectTab('projects')}
                        className="w-full text-left px-3 py-2 rounded-xl text-sm font-medium text-zinc-700 dark:text-white/70 hover:bg-zinc-100 dark:hover:bg-white/[0.08] hover:text-rose-600 dark:hover:text-rose-400 transition-colors flex items-center justify-between"
                        role="menuitem"
                      >
                        <span>Gestionar proyectos</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {projectsError && (
              <span className="hidden lg:inline text-2xs text-rose-600 dark:text-rose-300 truncate max-w-[240px]">
                {projectsError}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-xl glass-inset hover:bg-black/5 dark:hover:bg-white/10 text-zinc-700 dark:text-white/70 hover:text-zinc-900 dark:hover:text-white transition-colors flex items-center gap-1.5"
              aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="w-4 h-4 text-amber-300 transition-transform duration-200 hover:rotate-45" />
                  <span className="text-2xs font-medium hidden sm:inline text-zinc-300">Claro</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-zinc-800 transition-transform duration-200 hover:-rotate-12" />
                  <span className="text-2xs font-medium hidden sm:inline text-zinc-700">Oscuro</span>
                </>
              )}
            </button>

            <div className="relative">
              <button
                onClick={() => setShowUserMenu((value) => !value)}
                className="flex items-center gap-2 px-2.5 sm:px-3 py-1.5 rounded-xl glass-inset hover:bg-black/5 dark:hover:bg-white/10 text-xs text-zinc-800 dark:text-white/80 font-medium transition-colors"
                aria-label="Abrir menú de cuenta"
                aria-haspopup="menu"
                aria-expanded={showUserMenu}
              >
                <UserCheck className="w-4 h-4 text-zinc-600 dark:text-white/60" />
                <span className="font-mono text-2xs font-semibold hidden sm:inline">
                  {labelFor(ROLE_LABELS, currentRole)}
                </span>
                <ChevronRight className="w-3 h-3 text-zinc-500 dark:text-white/60 rotate-90 ml-0.5" />
              </button>

              {showUserMenu && user && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowUserMenu(false)}
                    aria-hidden="true"
                  />
                  <div
                    className="absolute right-0 mt-2 w-[min(18rem,calc(100vw-2rem))] bg-white dark:bg-[#0c0d14] rounded-2xl p-3 z-50 shadow-2xl border border-zinc-200 dark:border-rose-500/30 animate-in fade-in zoom-in-95 space-y-2.5"
                    role="menu"
                    aria-label="Cuenta autenticada"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-white/10 flex items-center justify-center text-zinc-700 dark:text-white/80 border border-zinc-200 dark:border-white/10">
                        <UserCircle2 className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-zinc-900 dark:text-white truncate">
                          {user.displayName}
                        </p>
                        <p className="text-2xs text-zinc-600 dark:text-white/65 truncate">{user.email}</p>
                      </div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-zinc-50 dark:bg-black/30 border border-zinc-200/80 dark:border-white/10 text-2xs text-zinc-600 dark:text-white/65 flex items-center justify-between">
                      <span>Rol efectivo</span>
                      <span className="font-mono font-semibold text-zinc-900 dark:text-white">
                        {ROLE_LABELS[user.role] || user.role}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        setShowUserMenu(false);
                        logout();
                      }}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl glass-btn-secondary text-sm font-medium"
                    >
                      <LogOut className="w-4 h-4" /> Cerrar sesión
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto pr-1 pb-2">{children}</main>
      </div>
    </div>
  );
};
