import type { NavTab } from '../components/layout/Shell';

/**
 * Intención de navegación que viaja junto al cambio de pestaña.
 *
 * El flujo guiado crea proyecto → abre la carga del CSV → selecciona el
 * dataset en el diseñador → preselecciona arquitectura y dataset en
 * entrenamiento. `id` identifica cada intención para que la vista la aplique
 * una sola vez aunque se vuelva a montar.
 */
export interface GuidedTarget {
  id: number;
  /** Abre el modal de carga de CSV al entrar en Conjuntos de datos. */
  openUpload?: boolean;
  /** Dataset que debe quedar seleccionado en el diseñador o en entrenamiento. */
  datasetId?: string;
  /** Arquitectura que debe quedar seleccionada en entrenamiento. */
  architectureId?: string;
}

export type NavigateFn = (tab: NavTab, target?: Omit<GuidedTarget, 'id'>) => void;
