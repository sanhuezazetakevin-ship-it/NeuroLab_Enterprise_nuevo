// Etiquetas de presentación en español.
// Las claves conservan los valores técnicos que viajan a la API; sólo se
// traducen al mostrarlos en la interfaz.

import { JobStatus, ModelLifecycleStatus, NetworkFamily, UserRole } from '../types';

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  QUEUED: 'En cola',
  PREPARING: 'Preparando',
  RUNNING: 'En ejecución',
  COMPLETED: 'Completado',
  FAILED: 'Fallido',
  CANCELLED: 'Cancelado',
};

export const MODEL_STATUS_LABELS: Record<ModelLifecycleStatus, string> = {
  DRAFT: 'Borrador',
  REVIEWED: 'Revisado',
  APPROVED: 'Aprobado',
  RETIRED: 'Retirado',
};

export const TASK_LABELS: Record<string, string> = {
  classification: 'Clasificación',
  regression: 'Regresión',
};

export const FAMILY_LABELS: Record<NetworkFamily, string> = {
  FEEDFORWARD: 'Feedforward (FNN)',
  RNN: 'Recurrente (RNN / LSTM)',
  CNN: 'Convolucional (CNN)',
  GAN: 'Generativa (GAN)',
};

export const FAMILY_SHORT_LABELS: Record<NetworkFamily, string> = {
  FEEDFORWARD: 'FNN',
  RNN: 'RNN',
  CNN: 'CNN',
  GAN: 'GAN',
};

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Administrador',
  PROJECT_LEAD: 'Responsable de Proyecto',
  AI_ENGINEER: 'Ingeniero de IA',
  REVIEWER: 'Revisor / Auditor',
  VIEWER: 'Lector',
};

export const USER_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Activo',
  INACTIVE: 'Inactivo',
  SUSPENDED: 'Suspendido',
};

export const PROJECT_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Activo',
  ARCHIVED: 'Archivado',
};

export const SYSTEM_STATUS_LABELS: Record<string, string> = {
  healthy: 'Operativo',
  degraded: 'Degradado',
  unhealthy: 'Con fallas',
  ok: 'Correcto',
  error: 'Con errores',
  unavailable: 'No disponible',
};

/** Devuelve la etiqueta en español o el valor original si no hay traducción. */
export function labelFor(
  map: Record<string, string>,
  value?: string | null,
): string {
  if (value == null || value === '') return '—';
  return map[value] ?? value;
}
