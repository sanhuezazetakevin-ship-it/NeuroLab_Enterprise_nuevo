import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck,
  Users,
  Clock,
  Lock,
  Check,
  X,
  UserPlus,
  Search,
  RefreshCw,
  AlertTriangle,
  Loader2,
  Server,
  Database,
  Activity,
  ShieldAlert,
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
import { formatDateTime, shortId } from '../../lib/format';
import { AuditEvent, SystemStatus, User, UserRole } from '../../types';

const ROLES: UserRole[] = ['ADMIN', 'PROJECT_LEAD', 'AI_ENGINEER', 'REVIEWER', 'VIEWER'];
const STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;

const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Administrador',
  PROJECT_LEAD: 'Responsable de Proyecto',
  AI_ENGINEER: 'Ingeniero de IA',
  REVIEWER: 'Revisor / Auditor',
  VIEWER: 'Lector',
};

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

export const AdministrationView: React.FC = () => {
  const { currentRole, activeProject, showToast } = useApp();
  const { user: currentUser } = useAuth();

  const [users, setUsers] = useState<User[]>([]);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [systemError, setSystemError] = useState<string | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [auditSearch, setAuditSearch] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('AI_ENGINEER');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const isAdmin = currentRole === 'ADMIN';

  const loadData = useCallback(
    async (silent = false) => {
      if (!isAdmin) return;
      if (!silent) setLoading(true);
      const [usersResult, systemResult, auditResult] = await Promise.allSettled([
        ApiClient.listUsers(),
        ApiClient.systemStatus(),
        activeProject ? ApiClient.listAuditEvents(activeProject.id, undefined, 200) : Promise.resolve([]),
      ]);

      if (usersResult.status === 'fulfilled') {
        setUsers(usersResult.value);
        setError(null);
      } else {
        setError(
          usersResult.reason instanceof Error
            ? usersResult.reason.message
            : 'No fue posible cargar los usuarios',
        );
      }

      if (systemResult.status === 'fulfilled') {
        setSystem(systemResult.value);
        setSystemError(null);
      } else {
        setSystem(null);
        setSystemError(
          systemResult.reason instanceof Error
            ? systemResult.reason.message
            : 'No fue posible consultar el estado del sistema',
        );
      }

      if (auditResult.status === 'fulfilled') {
        setAuditEvents(auditResult.value);
        setAuditError(null);
      } else {
        setAuditEvents([]);
        setAuditError(
          auditResult.reason instanceof Error
            ? auditResult.reason.message
            : 'No fue posible cargar la auditoría del proyecto',
        );
      }

      setLoading(false);
    },
    [isAdmin, activeProject],
  );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData(true);
    setRefreshing(false);
  };

  const handleCreateUser = async () => {
    const email = newEmail.trim();
    const displayName = newDisplayName.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setCreateError('Ingrese un correo electrónico válido');
      return;
    }
    if (displayName.length < 2) {
      setCreateError('El nombre visible debe tener al menos 2 caracteres');
      return;
    }
    if (newPassword.length < 8) {
      setCreateError('La contraseña debe tener al menos 8 caracteres');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const created = await ApiClient.createUser({
        email,
        password: newPassword,
        displayName,
        role: newRole,
      });
      setUsers((prev) => [...prev, created]);
      setShowCreateModal(false);
      setNewEmail('');
      setNewPassword('');
      setNewDisplayName('');
      setNewRole('AI_ENGINEER');
      showToast(`Usuario ${created.email} creado con rol ${created.role}`, 'success');
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'No fue posible crear el usuario');
    } finally {
      setCreating(false);
    }
  };

  const handleUserUpdate = async (target: User, patch: { role?: UserRole; status?: string }) => {
    setUpdatingId(target.id);
    try {
      const updated = await ApiClient.updateUser(target.id, patch);
      setUsers((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      showToast(`Usuario ${updated.email} actualizado`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No fue posible actualizar el usuario', 'error');
    } finally {
      setUpdatingId(null);
    }
  };

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter(
      (item) =>
        item.email.toLowerCase().includes(term) ||
        item.displayName.toLowerCase().includes(term) ||
        item.role.toLowerCase().includes(term),
    );
  }, [users, search]);

  const filteredAudit = useMemo(() => {
    const term = auditSearch.trim().toLowerCase();
    if (!term) return auditEvents;
    return auditEvents.filter((event) => {
      const haystack = [
        event.action,
        event.actorName || '',
        event.actorId || '',
        JSON.stringify(event.metadata || {}),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [auditEvents, auditSearch]);

  const rbacModules = useMemo(
    () => [
      { module: 'M01 Dashboard', admin: true, lead: true, engineer: true, reviewer: true, viewer: true },
      { module: 'M02 Proyectos (Crear/Editar)', admin: true, lead: true, engineer: true, reviewer: false, viewer: false },
      { module: 'M03 Fundamentos (Lectura)', admin: true, lead: true, engineer: true, reviewer: true, viewer: true },
      { module: 'M04 Diseñador (Crear/Editar)', admin: true, lead: true, engineer: true, reviewer: false, viewer: false },
      { module: 'M05 Conjuntos de datos (Subir/Eliminar)', admin: true, lead: true, engineer: true, reviewer: false, viewer: false },
      { module: 'M06 Entrenamientos (Iniciar/Cancelar)', admin: true, lead: true, engineer: true, reviewer: false, viewer: false },
      { module: 'M07 Evaluación (Consultar Métricas)', admin: true, lead: true, engineer: true, reviewer: true, viewer: true },
      { module: 'M08 Registro (Aprobar/Retirar)', admin: true, lead: true, engineer: false, reviewer: false, viewer: false },
      { module: 'M09 Reportes (Exportar)', admin: true, lead: true, engineer: true, reviewer: true, viewer: true },
      { module: 'M10 Administración (Usuarios/Sistema)', admin: true, lead: false, engineer: false, reviewer: false, viewer: false },
    ],
    [],
  );

  if (!isAdmin) {
    return (
      <div className="space-y-4 animate-in fade-in duration-200">
        <div className="pb-2 border-b border-black/10 dark:border-white/10">
          <div className="flex items-center gap-2 text-zinc-600 dark:text-white/60 text-xs font-semibold uppercase tracking-wider">
            <ShieldCheck className="w-4 h-4 text-zinc-700 dark:text-white/80" /> Módulo 10 • Administración
          </div>
          <h1 className="text-xl sm:text-2xl font-semibold text-zinc-900 dark:text-white mt-1">
            Control de Acceso (RBAC) &amp; Auditoría
          </h1>
        </div>
        <div className="glass-card rounded-2xl p-8 flex flex-col items-center justify-center text-center gap-3 min-h-[260px]">
          <div className="w-12 h-12 rounded-2xl glass-inset flex items-center justify-center text-rose-600 dark:text-rose-300">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">Acceso restringido</h3>
            <p className="text-xs text-zinc-500 dark:text-white/65 mt-1 max-w-md">
              La administración de usuarios y el estado del sistema están disponibles únicamente para el rol
              ADMIN. Su rol actual es <strong className="font-mono text-zinc-700 dark:text-white/70">{currentRole}</strong>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-black/10 dark:border-white/10">
        <div>
          <div className="flex items-center gap-2 text-zinc-600 dark:text-white/60 text-xs font-semibold uppercase tracking-wider">
            <ShieldCheck className="w-4 h-4 text-zinc-700 dark:text-white/80" /> Módulo 10 • Administración &amp; Seguridad
          </div>
          <h1 className="text-xl sm:text-2xl font-semibold text-zinc-900 dark:text-white mt-1">
            Control de Acceso (RBAC), Usuarios &amp; Auditoría
          </h1>
          <p className="text-xs text-zinc-500 dark:text-white/65 mt-0.5">
            Gobernanza corporativa, cuentas reales en PostgreSQL, estado de servicios y trazabilidad de
            acciones por proyecto.
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
            onClick={() => {
              setCreateError(null);
              setShowCreateModal(true);
            }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl glass-btn-primary text-xs font-semibold"
          >
            <UserPlus className="w-4 h-4" /> Crear Usuario
          </button>
        </div>
      </div>

      {loading && users.length === 0 && <LoadingBlock label="Cargando usuarios y estado del sistema…" />}
      {error && <ErrorBlock message={error} onRetry={() => loadData()} />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 glass-card p-5 rounded-2xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
              <Users className="w-4 h-4 text-zinc-600 dark:text-white/70" /> Directorio de Usuarios ({users.length})
            </h2>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-400 dark:text-white/65 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Buscar por nombre, correo o rol…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="glass-input rounded-xl pl-8 pr-3 py-1.5 w-64 text-xs"
              />
            </div>
          </div>

          {filteredUsers.length === 0 ? (
            <EmptyBlock
              icon={Users}
              title={users.length === 0 ? 'Sin usuarios registrados' : 'Sin resultados'}
              description={users.length === 0 ? 'Cree la primera cuenta corporativa.' : 'Ajuste el término de búsqueda.'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-black/10 dark:border-white/10 text-zinc-500 dark:text-white/65">
                    <th className="pb-2.5 font-medium">Usuario</th>
                    <th className="pb-2.5 font-medium">Rol</th>
                    <th className="pb-2.5 font-medium">Estado</th>
                    <th className="pb-2.5 font-medium">Creado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5 dark:divide-white/5">
                  {filteredUsers.map((item) => {
                    const isSelf = item.id === currentUser?.id;
                    const busy = updatingId === item.id;
                    return (
                      <tr key={item.id} className="hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-colors">
                        <td className="py-3">
                          <div className="font-semibold text-zinc-900 dark:text-white flex items-center gap-1.5">
                            {item.displayName}
                            {isSelf && (
                              <span className="text-xs font-mono px-1.5 py-0.5 rounded-full glass-inset border border-black/10 dark:border-white/10 text-zinc-500 dark:text-white/65">
                                tú
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-zinc-600 dark:text-white/65 font-mono">{item.email}</div>
                        </td>
                        <td className="py-3">
                          <select
                            value={item.role}
                            disabled={busy}
                            onChange={(event) =>
                              handleUserUpdate(item, { role: event.target.value as UserRole })
                            }
                            className="glass-input rounded-lg px-2 py-1 text-xs bg-transparent dark:bg-zinc-900 text-zinc-900 dark:text-white disabled:opacity-50"
                          >
                            {ROLES.map((role) => (
                              <option
                                key={role}
                                value={role}
                                className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white"
                              >
                                {role}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-3">
                          <select
                            value={item.status}
                            disabled={busy || isSelf}
                            title={isSelf ? 'No puede desactivar su propia cuenta' : undefined}
                            onChange={(event) => handleUserUpdate(item, { status: event.target.value })}
                            className="glass-input rounded-lg px-2 py-1 text-xs bg-transparent dark:bg-zinc-900 text-zinc-900 dark:text-white disabled:opacity-50"
                          >
                            {STATUSES.map((status) => (
                              <option
                                key={status}
                                value={status}
                                className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white"
                              >
                                {status}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-3 text-zinc-500 dark:text-white/65 font-mono text-xs whitespace-nowrap">
                          {busy ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            formatDateTime(item.createdAt)
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="glass-card p-5 rounded-2xl space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
              <Server className="w-4 h-4 text-zinc-600 dark:text-white/70" /> Estado del Sistema
            </h2>
            {system && (
              <span
                className={`text-xs font-mono px-2 py-0.5 rounded-full glass-inset border ${
                  system.status === 'healthy'
                    ? 'text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                    : 'text-amber-700 dark:text-amber-300 border-amber-500/30'
                }`}
              >
                {system.status}
              </span>
            )}
          </div>

          {systemError && <p className="text-xs text-rose-600 dark:text-rose-300">{systemError}</p>}

          {system ? (
            <div className="space-y-3 text-xs">
              {[
                { label: 'Base de datos', value: system.database, icon: Database },
                { label: 'Redis', value: system.redis, icon: Activity },
                { label: 'Cola de trabajos', value: system.queueBackend, icon: Server },
                { label: 'Entorno', value: system.environment, icon: ShieldCheck },
                { label: 'Versión API', value: system.version, icon: Activity },
                { label: 'Uptime', value: uptimeLabel(system.uptimeSeconds), icon: Clock },
              ].map((row) => {
                const Icon = row.icon;
                return (
                  <div key={row.label} className="flex items-center justify-between gap-2">
                    <span className="text-zinc-500 dark:text-white/65 flex items-center gap-1.5">
                      <Icon className="w-3.5 h-3.5" /> {row.label}
                    </span>
                    <span className="font-mono text-zinc-800 dark:text-white/80 truncate">{row.value}</span>
                  </div>
                );
              })}

              <div className="pt-3 border-t border-black/10 dark:border-white/10 space-y-1.5">
                <span className="text-xs uppercase font-bold tracking-wider text-zinc-500 dark:text-white/65">
                  Límites configurados
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(system.limits).map(([key, value]) => (
                    <span
                      key={key}
                      className="text-xs font-mono px-1.5 py-0.5 rounded-full glass-inset border border-black/10 dark:border-white/10 text-zinc-600 dark:text-white/60"
                    >
                      {key}={value}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            !systemError && (
              <p className="text-xs text-zinc-500 dark:text-white/65 flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Consultando servicios…
              </p>
            )
          )}
        </div>
      </div>

      <div className="glass-card p-5 rounded-2xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
            <Lock className="w-4 h-4 text-zinc-600 dark:text-white/70" /> Matriz de Permisos RBAC por Módulo
          </h2>
          <span className="text-xs text-zinc-500 dark:text-white/65">
            Rol efectivo de su sesión: <strong className="text-zinc-900 dark:text-white font-mono">{currentRole}</strong>
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-center text-xs">
            <thead>
              <tr className="border-b border-black/10 dark:border-white/10 text-zinc-500 dark:text-white/65">
                <th className="pb-2.5 text-left font-medium">Módulo del Sistema</th>
                <th className="pb-2.5 font-medium">ADMIN</th>
                <th className="pb-2.5 font-medium">PROJECT_LEAD</th>
                <th className="pb-2.5 font-medium">AI_ENGINEER</th>
                <th className="pb-2.5 font-medium">REVIEWER</th>
                <th className="pb-2.5 font-medium">VIEWER</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5 dark:divide-white/5 font-mono">
              {rbacModules.map((row) => (
                <tr key={row.module} className="hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
                  <td className="py-2.5 text-left font-sans font-medium text-zinc-800 dark:text-white/80">{row.module}</td>
                  {[row.admin, row.lead, row.engineer, row.reviewer, row.viewer].map((allowed, index) => (
                    <td key={index} className="py-2.5">
                      {allowed ? (
                        <Check className="w-4 h-4 text-zinc-900 dark:text-white mx-auto" />
                      ) : (
                        <X className="w-4 h-4 text-zinc-300 dark:text-white/20 mx-auto" />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="glass-card p-5 rounded-2xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-zinc-600 dark:text-white/70" /> Registro de Auditoría del Proyecto
          </h2>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-400 dark:text-white/65 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filtrar por acción, actor o metadata…"
              value={auditSearch}
              onChange={(event) => setAuditSearch(event.target.value)}
              className="glass-input rounded-xl pl-8 pr-3 py-1.5 w-72 text-xs"
            />
          </div>
        </div>

        {!activeProject ? (
          <ProjectRequired action="Seleccione un proyecto para consultar su registro de auditoría." />
        ) : auditError ? (
          <ErrorBlock message={auditError} onRetry={() => loadData()} />
        ) : filteredAudit.length === 0 ? (
          <EmptyBlock
            icon={Clock}
            title={auditEvents.length === 0 ? 'Sin eventos de auditoría' : 'Sin coincidencias'}
            description={
              auditEvents.length === 0
                ? 'Las acciones sobre el proyecto se registrarán aquí de forma persistente.'
                : 'Ajuste el término de búsqueda.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-black/10 dark:border-white/10 text-zinc-500 dark:text-white/65">
                  <th className="pb-2">Tiempo</th>
                  <th className="pb-2">Actor</th>
                  <th className="pb-2">Acción</th>
                  <th className="pb-2">Metadata</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5 dark:divide-white/5">
                {filteredAudit.map((event) => (
                  <tr key={event.id} className="hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
                    <td className="py-2.5 text-zinc-500 dark:text-white/65 font-sans whitespace-nowrap">
                      {formatDateTime(event.createdAt)}
                    </td>
                    <td className="py-2.5 text-zinc-700 dark:text-white/80">
                      {event.actorName || shortId(event.actorId, 8)}
                    </td>
                    <td className="py-2.5 text-zinc-900 dark:text-white font-medium">{event.action}</td>
                    <td className="py-2.5 text-zinc-600 dark:text-white/60 font-sans max-w-[360px] truncate">
                      {JSON.stringify(event.metadata)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="glass-panel border border-black/15 dark:border-white/15 rounded-3xl p-6 max-w-md w-full space-y-4 shadow-glass animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-zinc-700 dark:text-white/80" /> Crear Usuario Corporativo
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-zinc-400 dark:text-white/65 hover:text-zinc-900 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-white/60 mb-1.5">
                Nombre Visible
              </label>
              <input
                type="text"
                placeholder="ej. Dra. Ana Beltrán"
                value={newDisplayName}
                onChange={(event) => setNewDisplayName(event.target.value)}
                className="w-full glass-input rounded-xl px-3 py-2 text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-white/60 mb-1.5">
                Correo Corporativo
              </label>
              <input
                type="email"
                placeholder="ana.beltran@neurolab.enterprise"
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
                className="w-full glass-input rounded-xl px-3 py-2 text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-white/60 mb-1.5">
                Contraseña Temporal (mín. 8 caracteres)
              </label>
              <input
                type="password"
                placeholder="••••••••"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className="w-full glass-input rounded-xl px-3 py-2 text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-white/60 mb-1.5">
                Rol RBAC Asignado
              </label>
              <select
                value={newRole}
                onChange={(event) => setNewRole(event.target.value as UserRole)}
                className="w-full glass-input rounded-xl px-3 py-2 text-xs bg-transparent dark:bg-zinc-900 text-zinc-900 dark:text-white"
              >
                {ROLES.map((role) => (
                  <option
                    key={role}
                    value={role}
                    className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white"
                  >
                    {role} — {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </div>

            {createError && (
              <p className="text-xs text-rose-600 dark:text-rose-300 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {createError}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-3.5 py-2 text-xs text-zinc-500 dark:text-white/65 hover:text-zinc-900 dark:hover:text-white"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateUser}
                disabled={creating}
                className="px-4 py-2 glass-btn-primary text-xs font-semibold rounded-xl disabled:opacity-50 flex items-center gap-1.5"
              >
                {creating && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Crear Usuario
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
