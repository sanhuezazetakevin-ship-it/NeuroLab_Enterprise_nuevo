import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Database,
  Upload,
  FileText,
  Table,
  Maximize2,
  X,
  RefreshCw,
  Trash2,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  Sliders,
} from 'lucide-react';
import { useApp } from '../../lib/AppContext';
import { ApiClient } from '../../lib/api';
import { Dataset, DatasetPreview } from '../../types';
import type { GuidedTarget, NavigateFn } from '../../lib/guidedFlow';
import { EnlargedChartModal } from '../../components/common/EnlargedChartModal';
import {
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  ProjectRequiredPage,
} from '../../components/common/ProjectGuard';
import { formatBytes, formatDate, formatNumber, shortId } from '../../lib/format';

const WRITE_ROLES = ['ADMIN', 'PROJECT_LEAD', 'AI_ENGINEER'];

function detectDelimiter(headerLine: string): string {
  const counts = [
    { value: ',', count: (headerLine.match(/,/g) || []).length },
    { value: ';', count: (headerLine.match(/;/g) || []).length },
    { value: '\t', count: (headerLine.match(/\t/g) || []).length },
  ];
  counts.sort((a, b) => b.count - a.count);
  return counts[0].count > 0 ? counts[0].value : ',';
}

async function readCsvHeaders(file: File): Promise<string[]> {
  const slice = file.slice(0, 64 * 1024);
  const text = await slice.text();
  const firstLine = text.split(/\r?\n/)[0] || '';
  const delimiter = detectDelimiter(firstLine);
  return firstLine
    .split(delimiter)
    .map((value) => value.trim().replace(/^"|"$/g, ''))
    .filter((value) => value.length > 0);
}

interface DatasetsViewProps {
  onNavigate?: NavigateFn;
  guided?: GuidedTarget | null;
  onGuidedConsumed?: (id: number) => void;
}

export const DatasetsView: React.FC<DatasetsViewProps> = ({
  onNavigate,
  guided,
  onGuidedConsumed,
}) => {
  const { activeProject, showToast, currentRole } = useApp();
  const projectId = activeProject?.id;
  const canWrite = WRITE_ROLES.includes(currentRole);

  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<DatasetPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enlargedOpen, setEnlargedOpen] = useState(false);

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [uploadTarget, setUploadTarget] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadHeaders, setUploadHeaders] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(
    () => datasets.find((dataset) => dataset.id === selectedId) || null,
    [datasets, selectedId],
  );

  const loadDatasets = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const list = await ApiClient.listDatasets(projectId);
      setDatasets(list);
      setError(null);
      setSelectedId((current) => {
        if (current && list.some((dataset) => dataset.id === current)) return current;
        return list[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible cargar los conjuntos de datos');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setDatasets([]);
    setSelectedId(null);
    setPreview(null);
    if (projectId) void loadDatasets();
  }, [projectId, loadDatasets]);

  useEffect(() => {
    let active = true;
    if (!projectId || !selectedId) {
      setPreview(null);
      return;
    }
    setPreviewLoading(true);
    ApiClient.previewDataset(projectId, selectedId)
      .then((data) => {
        if (active) setPreview(data);
      })
      .catch((err) => {
        if (active) {
          setPreview(null);
          showToast(err instanceof Error ? err.message : 'No fue posible cargar la vista previa', 'error');
        }
      })
      .finally(() => {
        if (active) setPreviewLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId, selectedId, showToast]);

  const resetUploadForm = () => {
    setUploadName('');
    setUploadTarget('');
    setUploadFile(null);
    setUploadHeaders([]);
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Flujo guiado: al llegar desde la creación del proyecto se abre el modal de
  // carga, de modo que el usuario no tenga que buscar el botón.
  useEffect(() => {
    if (!guided?.openUpload) return;
    if (!projectId || !canWrite) {
      onGuidedConsumed?.(guided.id);
      return;
    }
    resetUploadForm();
    setShowUploadModal(true);
    onGuidedConsumed?.(guided.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guided?.id, projectId, canWrite]);

  const handleFileSelected = async (file: File | null) => {
    setUploadFile(file);
    setUploadError(null);
    if (!file) {
      setUploadHeaders([]);
      setUploadTarget('');
      return;
    }
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setUploadError('El archivo debe tener extensión .csv');
      setUploadHeaders([]);
      return;
    }
    try {
      const headers = await readCsvHeaders(file);
      setUploadHeaders(headers);
      setUploadTarget(headers[headers.length - 1] || '');
      if (!uploadName) setUploadName(file.name.replace(/\.csv$/i, ''));
    } catch {
      setUploadError('No fue posible leer los encabezados del archivo');
    }
  };

  const handleUpload = async () => {
    if (!projectId) return;
    if (!uploadFile) {
      setUploadError('Debe seleccionar un archivo CSV');
      return;
    }
    if (!uploadTarget.trim()) {
      setUploadError('Indique la columna objetivo (target) para habilitar el entrenamiento');
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const created = await ApiClient.uploadDataset(
        projectId,
        uploadFile,
        uploadName.trim() || undefined,
        uploadTarget.trim(),
      );
      await loadDatasets();
      setSelectedId(created.id);
      setShowUploadModal(false);
      resetUploadForm();
      showToast(
        `Conjunto de datos "${created.name}" validado y registrado. Ahora diseñe la arquitectura.`,
        'success',
      );
      onNavigate?.('architectures', { datasetId: created.id });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'No fue posible cargar el conjunto de datos');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (dataset: Dataset) => {
    if (!projectId) return;
    if (!window.confirm(`¿Eliminar el conjunto de datos "${dataset.name}"? Esta acción no se puede deshacer.`)) {
      return;
    }
    try {
      await ApiClient.deleteDataset(projectId, dataset.id);
      showToast('Conjunto de datos eliminado', 'success');
      await loadDatasets();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No fue posible eliminar el conjunto de datos', 'error');
    }
  };

  const columns = preview?.columns || selected?.metadata.columns.map((column) => column.name) || [];
  const rows = preview?.rows || [];
  const targetColumn = selected?.targetColumn || selected?.metadata.targetColumn;

  const split = selected?.metadata
    ? {
        train: selected.metadata.trainSplit,
        val: selected.metadata.valSplit,
        test: selected.metadata.testSplit,
      }
    : { train: 0.7, val: 0.15, test: 0.15 };

  const renderTable = () => {
    if (previewLoading) {
      return (
        <div className="h-40 flex items-center justify-center gap-2 text-xs text-zinc-500 dark:text-white/65">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando vista previa…
        </div>
      );
    }
    if (!rows.length) {
      return (
        <div className="h-40 flex items-center justify-center text-xs text-zinc-500 dark:text-white/65">
          Sin vista previa disponible.
        </div>
      );
    }
    return (
      <table className="w-full text-left text-xs font-mono">
        <thead>
          <tr className="border-b border-black/10 dark:border-white/10 text-zinc-500 dark:text-white/65 font-sans">
            {columns.map((column) => (
              <th key={column} className="pb-2.5 px-3 font-medium whitespace-nowrap">
                <div className="flex items-center gap-1.5">
                  {column}
                  {column === targetColumn && (
                    <span className="text-xs uppercase px-1.5 py-0.2 rounded-full bg-black/10 dark:bg-white/15 text-zinc-700 dark:text-white/80">
                      target
                    </span>
                  )}
                </div>
                <span className="text-xs text-zinc-400 dark:text-white/30 uppercase font-normal">
                  {preview?.dtypes?.[column] || selected?.metadata.dtypes?.[column] || ''}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-black/5 dark:divide-white/5">
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-colors">
              {columns.map((column) => {
                const value = row[column];
                return (
                  <td key={column} className="py-2.5 px-3 whitespace-nowrap">
                    {column === targetColumn ? (
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold glass-inset text-zinc-900 dark:text-white border border-black/15 dark:border-white/15">
                        {value == null ? '—' : String(value)}
                      </span>
                    ) : (
                      <span className="text-zinc-700 dark:text-white/80">{value == null ? '—' : String(value)}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  if (!activeProject) {
    return (
      <ProjectRequiredPage
        icon={Database}
        eyebrow="Módulo 05 • Conjuntos de datos y particiones"
        title="Gestión y Validación de Datos"
        description="CSV validado en servidor, checksum SHA-256 y partición determinista 70 / 15 / 15."
        action="Seleccione un proyecto para gestionar sus conjuntos de datos."
      />
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-black/10 dark:border-white/10">
        <div>
          <div className="flex items-center gap-2 text-zinc-600 dark:text-white/60 text-xs font-semibold uppercase tracking-wider">
            <Database className="w-4 h-4 text-zinc-700 dark:text-white/80" /> Módulo 05 • Conjuntos de datos y particiones
          </div>
          <h1 className="text-xl sm:text-2xl font-semibold text-zinc-900 dark:text-white mt-1">
            Gestión y Validación de Datos
          </h1>
          <p className="text-xs text-zinc-500 dark:text-white/65 mt-0.5">
            CSV validado en servidor, checksum SHA-256 y partición determinista 70 / 15 / 15.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadDatasets}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl glass-btn-secondary text-xs font-medium"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Actualizar
          </button>
          <button
            onClick={() => {
              resetUploadForm();
              setShowUploadModal(true);
            }}
            disabled={!canWrite}
            title={canWrite ? undefined : 'Su rol no permite cargar conjuntos de datos'}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold ${
              canWrite ? 'glass-btn-primary' : 'glass-btn-secondary opacity-40 cursor-not-allowed'
            }`}
          >
            <Upload className="w-4 h-4" /> Cargar conjunto de datos
          </button>
        </div>
      </div>

      {loading && datasets.length === 0 && <LoadingBlock label="Cargando conjuntos de datos del proyecto…" />}

      {error && <ErrorBlock message={error} onRetry={loadDatasets} />}

      {!loading && !error && datasets.length === 0 && (
        <div className="glass-card rounded-2xl p-10 flex flex-col items-center text-center gap-2">
          <Database className="w-6 h-6 text-zinc-400 dark:text-white/65" />
          <p className="text-sm font-semibold text-zinc-900 dark:text-white">Este proyecto aún no tiene conjuntos de datos</p>
          <p className="text-xs text-zinc-500 dark:text-white/65 max-w-md">
            Cargue un CSV con encabezados explícitos e indique la columna objetivo para habilitar el
            entrenamiento.
          </p>
          {canWrite && (
            <button
              onClick={() => {
                resetUploadForm();
                setShowUploadModal(true);
              }}
              className="mt-2 flex items-center gap-2 px-4 py-2.5 rounded-xl glass-btn-primary text-xs font-semibold"
            >
              <Upload className="w-4 h-4" /> Cargar primer conjunto de datos
            </button>
          )}
        </div>
      )}

      {datasets.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            {selected ? (
              <>
                <div className="glass-card p-5 rounded-2xl space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-2.5 rounded-xl glass-inset text-zinc-700 dark:text-white/80 border border-black/10 dark:border-white/10">
                        <FileText className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-semibold text-zinc-900 dark:text-white truncate">
                            {selected.name}
                          </h3>
                          <span className="text-xs px-2 py-0.5 rounded-full glass-inset text-zinc-700 dark:text-white/70 font-mono">
                            {selected.version}
                          </span>
                          {selected.verified && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> Verificado
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-zinc-500 dark:text-white/65 font-mono mt-0.5 truncate">
                          {selected.originalFilename || selected.storageKey}
                        </p>
                      </div>
                    </div>

                    {canWrite && (
                      <button
                        onClick={() => handleDelete(selected)}
                        className="p-2 rounded-xl text-zinc-400 dark:text-white/65 hover:text-rose-500 dark:hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
                        title="Eliminar conjunto de datos"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs border-t border-black/10 dark:border-white/10">
                    <div>
                      <span className="text-zinc-500 dark:text-white/65 text-xs uppercase font-bold tracking-wider">
                        Muestras
                      </span>
                      <p className="font-semibold text-zinc-900 dark:text-white font-mono mt-0.5">
                        {formatNumber(selected.metadata.samples)}
                      </p>
                    </div>
                    <div>
                      <span className="text-zinc-500 dark:text-white/65 text-xs uppercase font-bold tracking-wider">
                        Features
                      </span>
                      <p className="font-semibold text-zinc-900 dark:text-white font-mono mt-0.5">
                        {formatNumber(selected.metadata.featuresCount)}
                      </p>
                    </div>
                    <div>
                      <span className="text-zinc-500 dark:text-white/65 text-xs uppercase font-bold tracking-wider">
                        Tamaño
                      </span>
                      <p className="font-semibold text-zinc-900 dark:text-white font-mono mt-0.5">
                        {formatBytes(selected.sizeBytes)}
                      </p>
                    </div>
                    <div>
                      <span className="text-zinc-500 dark:text-white/65 text-xs uppercase font-bold tracking-wider">
                        Columna objetivo
                      </span>
                      <p className="font-semibold text-zinc-900 dark:text-white font-mono mt-0.5 truncate">
                        {targetColumn || 'No definida'}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-zinc-600 dark:text-white/60">
                    <div className="p-2.5 rounded-xl glass-inset border border-black/10 dark:border-white/10 flex items-center justify-between gap-2">
                      <span>Tarea inferida</span>
                      <span className="font-mono font-semibold text-zinc-900 dark:text-white">
                        {selected.metadata.task || '—'}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-xl glass-inset border border-black/10 dark:border-white/10 flex items-center justify-between gap-2">
                      <span>Registro</span>
                      <span className="font-mono text-zinc-800 dark:text-white/80">
                        {formatDate(selected.createdAt)}
                      </span>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-xl glass-inset border border-black/10 dark:border-white/10 text-xs flex items-center gap-2 overflow-hidden">
                    <span className="uppercase font-bold text-zinc-500 dark:text-white/65 tracking-wider shrink-0">
                      SHA-256
                    </span>
                    <code className="font-mono text-zinc-800 dark:text-white/80 truncate">
                      {selected.checksum || '—'}
                    </code>
                  </div>
                </div>

                <div className="glass-card p-5 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-900 dark:text-white/90 flex items-center gap-1.5 uppercase tracking-wider">
                      <Table className="w-4 h-4 text-zinc-600 dark:text-white/60" /> Vista previa (primeras filas)
                    </span>
                    <button
                      onClick={() => setEnlargedOpen(true)}
                      className="text-xs text-zinc-600 dark:text-white/70 hover:text-zinc-900 dark:hover:text-white font-medium flex items-center gap-1 transition-colors"
                    >
                      <span>Inspeccionar</span>
                      <Maximize2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="overflow-x-auto glass-inset rounded-xl p-2 border border-black/10 dark:border-white/10">
                    {renderTable()}
                  </div>
                </div>
              </>
            ) : (
              <EmptyBlock title="Seleccione un conjunto de datos" description="Elija un conjunto de datos del panel derecho." icon={Database} />
            )}
          </div>

          <div className="space-y-3.5">
            <div className="glass-card p-4 rounded-2xl space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-zinc-900 dark:text-white/90 flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-zinc-600 dark:text-white/70" /> Conjuntos de datos ({datasets.length})
                </span>
                <span className="text-xs text-zinc-500 dark:text-white/65">Proyecto activo</span>
              </div>
              <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                {datasets.map((dataset) => (
                  <button
                    key={dataset.id}
                    onClick={() => setSelectedId(dataset.id)}
                    className={`w-full text-left p-2.5 rounded-xl text-xs transition-colors ${
                      dataset.id === selectedId
                        ? 'bg-black/10 dark:bg-white/15 border border-black/10 dark:border-white/20'
                        : 'hover:bg-black/5 dark:hover:bg-white/[0.06] border border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-zinc-900 dark:text-white truncate">{dataset.name}</span>
                      <span className="text-xs font-mono text-zinc-500 dark:text-white/65 shrink-0">
                        {dataset.version}
                      </span>
                    </div>
                    <span className="text-xs text-zinc-500 dark:text-white/65">
                      {formatNumber(dataset.metadata.samples)} filas · {dataset.metadata.task || 'sin tarea'}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="glass-card p-4 rounded-2xl space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-zinc-900 dark:text-white/90 flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-zinc-600 dark:text-white/70" /> Partición determinista
                </span>
                <span className="font-mono text-xs text-zinc-600 dark:text-white/70">
                  {Math.round(split.train * 100)} / {Math.round(split.val * 100)} / {Math.round(split.test * 100)}
                </span>
              </div>

              <div className="h-2.5 rounded-full glass-inset overflow-hidden flex border border-black/10 dark:border-white/10">
                <div style={{ width: `${split.train * 100}%` }} className="bg-zinc-800 dark:bg-white" title="Train" />
                <div style={{ width: `${split.val * 100}%` }} className="bg-zinc-500 dark:bg-white/60" title="Validation" />
                <div style={{ width: `${split.test * 100}%` }} className="bg-zinc-300 dark:bg-white/30" title="Test" />
              </div>

              {[
                { label: 'Train', value: split.train, tone: 'bg-zinc-800 dark:bg-white' },
                { label: 'Validation', value: split.val, tone: 'bg-zinc-500 dark:bg-white/60' },
                { label: 'Test', value: split.test, tone: 'bg-zinc-300 dark:bg-white/30' },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between text-xs text-zinc-600 dark:text-white/60">
                  <span className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${item.tone}`} /> {item.label}
                  </span>
                  <span className="font-mono text-zinc-900 dark:text-white">
                    {Math.round(item.value * 100)}% ·{' '}
                    {formatNumber(Math.round((selected?.metadata.samples || 0) * item.value))} filas
                  </span>
                </div>
              ))}

              <p className="text-xs text-zinc-500 dark:text-white/65 leading-relaxed">
                La partición es fija y determinista; el worker aplica imputación y escalado solo con
                el conjunto de entrenamiento para evitar fuga de datos.
              </p>
            </div>

            {selected && preview && (
              <div className="glass-card p-4 rounded-2xl space-y-1.5 text-xs text-zinc-600 dark:text-white/60">
                <div className="flex justify-between">
                  <span>Filas leídas</span>
                  <span className="font-mono text-zinc-900 dark:text-white">{formatNumber(preview.totalRows)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Columnas</span>
                  <span className="font-mono text-zinc-900 dark:text-white">{preview.columns.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>ID</span>
                  <span className="font-mono text-zinc-900 dark:text-white">{shortId(selected.id)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <EnlargedChartModal
        isOpen={enlargedOpen}
        onClose={() => setEnlargedOpen(false)}
        title={`Inspección del conjunto de datos: ${selected?.name || ''}`}
        subtitle="Vista tabular de variables y columna objetivo"
        badge={`${formatNumber(preview?.totalRows ?? selected?.metadata.samples)} muestras`}
      >
        <div className="space-y-4">
          <div className="glass-inset rounded-2xl p-4 overflow-x-auto border border-black/10 dark:border-white/10">
            {renderTable()}
          </div>
          <p className="text-xs text-zinc-500 dark:text-white/65">
            La vista previa se genera en el servidor a partir del archivo almacenado; no se
            reconstruyen datos en el navegador.
          </p>
        </div>
      </EnlargedChartModal>

      {showUploadModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="glass-panel border border-black/15 dark:border-white/15 rounded-3xl p-6 max-w-md w-full space-y-4 shadow-glass animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-zinc-900 dark:text-white">Cargar nuevo conjunto de datos</h3>
              <button
                onClick={() => setShowUploadModal(false)}
                className="text-zinc-400 dark:text-white/65 hover:text-zinc-900 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-white/60 mb-1.5">
                Nombre del conjunto de datos
              </label>
              <input
                type="text"
                placeholder="ej. churn_telecom_2026"
                value={uploadName}
                onChange={(event) => setUploadName(event.target.value)}
                className="w-full glass-input rounded-xl px-3 py-2 text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-white/60 mb-1.5">
                Archivo CSV
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => void handleFileSelected(event.target.files?.[0] || null)}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-black/20 dark:border-white/20 rounded-2xl p-5 text-center text-xs text-zinc-500 dark:text-white/65 space-y-1.5 hover:border-black/40 dark:hover:border-white/40 transition-colors"
              >
                <Upload className="w-5 h-5 mx-auto text-zinc-600 dark:text-white/60" />
                <p>{uploadFile ? uploadFile.name : 'Seleccione un archivo CSV'}</p>
                <span className="text-xs text-zinc-400 dark:text-white/65 font-mono">
                  {uploadFile ? formatBytes(uploadFile.size) : 'Máximo permitido por el servidor'}
                </span>
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-white/60 mb-1.5">
                Columna Objetivo (target)
              </label>
              {uploadHeaders.length > 0 ? (
                <select
                  value={uploadTarget}
                  onChange={(event) => setUploadTarget(event.target.value)}
                  className="w-full glass-input rounded-xl px-3 py-2 text-xs"
                >
                  <option value="">Seleccione la columna objetivo…</option>
                  {uploadHeaders.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  placeholder="Nombre exacto de la columna objetivo"
                  value={uploadTarget}
                  onChange={(event) => setUploadTarget(event.target.value)}
                  className="w-full glass-input rounded-xl px-3 py-2 text-xs font-mono"
                />
              )}
              <p className="text-xs text-zinc-500 dark:text-white/65 mt-1">
                Obligatoria para inferir la tarea y habilitar entrenamientos.
              </p>
            </div>

            {uploadError && (
              <p className="text-xs text-rose-600 dark:text-rose-300 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {uploadError}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowUploadModal(false)}
                className="px-3.5 py-2 text-xs text-zinc-500 dark:text-white/65 hover:text-zinc-900 dark:hover:text-white transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleUpload}
                disabled={uploading}
                className="px-4 py-2 glass-btn-primary text-xs font-semibold rounded-xl disabled:opacity-50 flex items-center gap-1.5"
              >
                {uploading && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Validar & Registrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
