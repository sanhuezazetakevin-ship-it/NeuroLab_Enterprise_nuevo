import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ApiClient } from './api';
import { useAuth } from './AuthContext';
import { Project, UserRole } from '../types';

interface ToastInfo {
  id: string;
  message: string;
  type: 'success' | 'info' | 'warning' | 'error';
}

interface AppContextType {
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  currentRole: UserRole;
  toasts: ToastInfo[];
  showToast: (message: string, type?: ToastInfo['type']) => void;
  removeToast: (id: string) => void;
  walkthroughOpen: boolean;
  setWalkthroughOpen: (open: boolean) => void;
  activeProject: Project | null;
  setActiveProject: (project: Project) => void;
  projects: Project[];
  refreshProjects: () => Promise<Project[]>;
  projectsLoading: boolean;
  projectsError: string | null;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const ACTIVE_PROJECT_KEY = 'neurolab_active_project';

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('neurolab_theme');
    return saved === 'light' ? 'light' : 'dark';
  });
  const [toasts, setToasts] = useState<ToastInfo[]>([]);
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(
    localStorage.getItem(ACTIVE_PROJECT_KEY),
  );
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastInfo['type'] = 'success') => {
      const id = Math.random().toString(36).substring(2, 9);
      setToasts((prev) => [...prev, { id, message, type }]);
      setTimeout(() => removeToast(id), 4500);
    },
    [removeToast],
  );

  const refreshProjects = useCallback(async () => {
    setProjectsLoading(true);
    try {
      const list = await ApiClient.listProjects();
      setProjects(list);
      setProjectsError(null);
      setActiveProjectId((current) => {
        if (current && list.some((project) => project.id === current)) return current;
        return list[0]?.id ?? null;
      });
      return list;
    } catch (error) {
      setProjectsError(error instanceof Error ? error.message : 'No fue posible cargar proyectos');
      return [];
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) void refreshProjects();
  }, [user, refreshProjects]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }
    localStorage.setItem('neurolab_theme', theme);
  }, [theme]);

  useEffect(() => {
    if (activeProjectId) localStorage.setItem(ACTIVE_PROJECT_KEY, activeProjectId);
    else localStorage.removeItem(ACTIVE_PROJECT_KEY);
  }, [activeProjectId]);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) || null,
    [projects, activeProjectId],
  );

  const setActiveProject = useCallback((project: Project) => {
    setActiveProjectId(project.id);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  return (
    <AppContext.Provider
      value={{
        theme,
        toggleTheme,
        currentRole: (user?.role || 'VIEWER') as UserRole,
        toasts,
        showToast,
        removeToast,
        walkthroughOpen,
        setWalkthroughOpen,
        activeProject,
        setActiveProject,
        projects,
        refreshProjects,
        projectsLoading,
        projectsError,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = (): AppContextType => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within an AppProvider');
  return context;
};
