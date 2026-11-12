// ==========================================
// NEUROLAB ENTERPRISE - CLIENT API SERVICE
// ==========================================
// Cliente tipado para la API real (/api/v1). El backend usa snake_case;
// aquí se normaliza a camelCase para los componentes React.

import {
  Architecture,
  ArchitectureValidationResult,
  AuditEvent,
  Dataset,
  DatasetPreview,
  ModelLifecycleStatus,
  ModelMetrics,
  ModelVersion,
  NetworkTopology,
  PredictionResult,
  Project,
  ProjectMember,
  SystemStatus,
  TrainingJob,
  TrainingMetric,
  User,
  UserRole,
} from '../types';

// En producción Vercel inyecta VITE_API_URL. El valor por defecto apunta a la
// instancia local de NeuroLab (8000/5173 están reservados para VisionIA).
const API_BASE = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8012/api/v1').replace(/\/$/, '');
const TOKEN_KEY = 'neurolab_token';

type Json = Record<string, any>;

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(message: string, status: number, detail?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

function toCamel(value: string): string {
  return value.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
}

function mapKeys<T = Json>(input: Json | null | undefined): T {
  if (!input) return {} as T;
  const output: Json = {};
  Object.entries(input).forEach(([key, value]) => {
    output[toCamel(key)] = value;
  });
  return output as T;
}

function toApiTopology(topology: NetworkTopology) {
  return {
    input_shape: topology.inputShape,
    layers: topology.layers.map((layer) => ({
      id: layer.id,
      type: layer.type,
      units: layer.units,
      activation: layer.activation,
      rate: layer.rate,
      filters: layer.filters,
      kernel_size: layer.kernelSize,
      pool_size: layer.poolSize,
      return_sequences: layer.returnSequences,
    })),
  };
}

function fromApiTopology(raw: Json | null | undefined): NetworkTopology {
  const value = raw || {};
  return {
    inputShape: value.input_shape || value.inputShape || [],
    layers: (value.layers || []).map((layer: Json) => ({
      id: layer.id,
      type: layer.type,
      units: layer.units,
      activation: layer.activation,
      rate: layer.rate,
      filters: layer.filters,
      kernelSize: layer.kernel_size || layer.kernelSize,
      poolSize: layer.pool_size || layer.poolSize,
      returnSequences: layer.return_sequences ?? layer.returnSequences,
    })),
  };
}

function normalizeUser(raw: Json): User {
  return {
    id: raw.id,
    email: raw.email,
    displayName: raw.display_name,
    role: raw.role,
    status: raw.status,
    createdAt: raw.created_at,
  };
}

function normalizeProject(raw: Json): Project {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description || '',
    ownerId: raw.owner_id,
    status: raw.status,
    networkFamily: raw.network_family || 'FEEDFORWARD',
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    architecturesCount: raw.architectures_count ?? 0,
    datasetsCount: raw.datasets_count ?? 0,
    jobsCount: raw.jobs_count ?? 0,
    effectiveRole: raw.effective_role || undefined,
  };
}

function normalizeNeuronSummary(raw: Json | null | undefined) {
  if (!raw || !raw.available) {
    return {
      available: false,
      reason: raw?.reason || 'El dataset no tiene columna objetivo calculada',
      inputNeurons: 0,
      outputNeurons: 0,
      classLabels: [],
      classCount: 0,
      features: [],
    };
  }
  return {
    available: true,
    inputNeurons: raw.input_neurons ?? 0,
    outputNeurons: raw.output_neurons ?? 1,
    outputActivation: raw.output_activation || 'linear',
    loss: raw.loss || undefined,
    classLabels: raw.class_labels || [],
    classCount: raw.class_count ?? 0,
    features: (raw.features || []).map((feature: Json) => ({
      name: feature.name,
      kind: feature.kind,
      neurons: feature.neurons ?? 1,
      values: feature.values,
    })),
    truncated: Boolean(raw.truncated),
  };
}

function normalizeArchitecture(raw: Json): Architecture {
  return {
    id: raw.id,
    projectId: raw.project_id,
    name: raw.name,
    family: raw.family,
    config: fromApiTopology(raw.config_json || raw.config),
    version: raw.version,
    createdAt: raw.created_at,
  };
}

function normalizeDatasetMetadata(raw: Json | null | undefined) {
  const meta = raw || {};
  return {
    samples: meta.samples ?? 0,
    featuresCount: meta.features_count ?? meta.featuresCount ?? 0,
    targetColumn: meta.target_column ?? meta.targetColumn ?? undefined,
    task: meta.task || undefined,
    neurons: normalizeNeuronSummary(meta.neurons),
    columns: (meta.columns || []).map((column: Json) => ({
      name: column.name,
      dtype: column.dtype,
      nullCount: column.null_count ?? column.nullCount ?? 0,
      unique: column.unique ?? 0,
    })),
    nullCounts: meta.null_counts || meta.nullCounts || {},
    dtypes: meta.dtypes || {},
    trainSplit: meta.train_split ?? meta.trainSplit ?? 0.7,
    valSplit: meta.val_split ?? meta.valSplit ?? 0.15,
    testSplit: meta.test_split ?? meta.testSplit ?? 0.15,
    verified: meta.verified,
  };
}

function normalizeDataset(raw: Json): Dataset {
  return {
    id: raw.id,
    projectId: raw.project_id,
    name: raw.name,
    version: raw.version,
    storageKey: raw.storage_key,
    originalFilename: raw.original_filename || undefined,
    sizeBytes: raw.size_bytes ?? 0,
    checksum: raw.checksum || undefined,
    targetColumn: raw.target_column || undefined,
    verified: Boolean(raw.verified),
    metadata: normalizeDatasetMetadata(raw.metadata_json),
    createdAt: raw.created_at,
  };
}

function normalizeDatasetPreview(raw: Json): DatasetPreview {
  return {
    id: raw.id,
    columns: raw.columns || [],
    dtypes: raw.dtypes || {},
    rows: raw.rows || [],
    totalRows: raw.total_rows ?? 0,
    nullCounts: raw.null_counts || {},
  };
}

function metricRowToPoint(row: Json): TrainingMetric {
  // La API puede devolver filas individuales (epoch, metric_name, value)
  if (row.metric_name) {
    return { epoch: row.epoch, [toCamel(row.metric_name)]: row.metric_value };
  }
  const point: TrainingMetric = { epoch: row.epoch };
  Object.entries(row).forEach(([key, value]) => {
    if (key === 'epoch' || key === 'id' || key === 'job_id' || key === 'recorded_at') return;
    if (typeof value === 'number') {
      point[toCamel(key)] = value;
    }
  });
  return point;
}

function mergeMetrics(rows: Json[]): TrainingMetric[] {
  const byEpoch = new Map<number, TrainingMetric>();
  rows.forEach((row) => {
    const point = metricRowToPoint(row);
    const current = byEpoch.get(point.epoch) || { epoch: point.epoch };
    byEpoch.set(point.epoch, { ...current, ...point });
  });
  return Array.from(byEpoch.values()).sort((a, b) => a.epoch - b.epoch);
}

function normalizeHyperparameters(raw: Json | null | undefined) {
  const hp = raw || {};
  return {
    epochs: hp.epochs ?? 30,
    batchSize: hp.batch_size ?? hp.batchSize ?? 32,
    optimizer: hp.optimizer ?? 'adam',
    learningRate: hp.learning_rate ?? hp.learningRate ?? 0.001,
    loss: hp.loss ?? undefined,
    metrics: hp.metrics || ['accuracy'],
    randomSeed: hp.random_seed ?? hp.randomSeed ?? 42,
    validationSplit: hp.validation_split ?? hp.validationSplit ?? 0.15,
    targetColumn: hp.target_column ?? hp.targetColumn ?? undefined,
    task: hp.task ?? undefined,
  };
}

function normalizeTrainingJob(raw: Json): TrainingJob {
  const metrics = Array.isArray(raw.metrics) ? mergeMetrics(raw.metrics) : [];
  return {
    id: raw.id,
    projectId: raw.project_id,
    architectureId: raw.architecture_id,
    datasetId: raw.dataset_id,
    status: raw.status,
    progress: raw.progress ?? 0,
    hyperparameters: normalizeHyperparameters(raw.hyperparameters),
    cancelRequested: Boolean(raw.cancel_requested),
    startedAt: raw.started_at || undefined,
    endedAt: raw.ended_at || undefined,
    errorMessage: raw.error_message || undefined,
    createdAt: raw.created_at,
    metrics,
  };
}

function normalizeModelMetrics(raw: Json | null | undefined): ModelMetrics | null {
  if (!raw) return null;
  const metrics: ModelMetrics = {
    accuracy: raw.accuracy ?? raw.test_accuracy,
    loss: raw.test_loss ?? raw.loss,
    valAccuracy: raw.val_accuracy,
    valLoss: raw.val_loss,
    f1Score: raw.f1_score,
    testAccuracy: raw.test_accuracy,
    testLoss: raw.test_loss,
    precision: raw.precision,
    recall: raw.recall,
    testMse: raw.test_mse,
    testRmse: raw.test_rmse,
    testMae: raw.test_mae,
    r2Score: raw.r2_score,
    rocAuc: raw.roc_auc,
    prAuc: raw.pr_auc,
    balancedAccuracy: raw.balanced_accuracy,
    decisionThreshold: raw.decision_threshold,
    confusionMatrix: raw.confusion_matrix,
    classLabels: raw.class_labels,
    epochsCompleted: raw.epochs_completed,
    samplesTest: raw.samples_test,
    task: raw.task,
    artifacts: raw.artifacts,
    datasetChecksum: raw.dataset_checksum,
    datasetVersion: raw.dataset_version,
    inputSchema: raw.input_schema,
    featureColumns: raw.feature_columns,
    baselineComparison: raw.baseline_comparison
      ? {
          available: Boolean(raw.baseline_comparison.available),
          metric: raw.baseline_comparison.metric,
          modelScore: raw.baseline_comparison.model_score,
          bestBaseline: raw.baseline_comparison.best_baseline,
          bestBaselineScore: raw.baseline_comparison.best_baseline_score,
          delta: raw.baseline_comparison.delta,
          beatsBaseline: raw.baseline_comparison.beats_baseline,
        }
      : undefined,
  };
  return metrics;
}

function normalizeModelVersion(raw: Json): ModelVersion {
  return {
    id: raw.id,
    projectId: raw.project_id,
    jobId: raw.job_id,
    version: raw.version,
    storageKey: raw.storage_key,
    status: raw.status,
    checksum: raw.checksum,
    metricsSummary: normalizeModelMetrics(raw.metrics_summary),
    createdAt: raw.created_at,
  };
}

function normalizeAuditEvent(raw: Json): AuditEvent {
  return {
    id: raw.id,
    actorId: raw.actor_id || undefined,
    actorName: raw.actor_name || undefined,
    projectId: raw.project_id || undefined,
    action: raw.action,
    metadata: raw.metadata_json || {},
    createdAt: raw.created_at,
  };
}

function errorDetailMessage(detail: unknown, fallback: string): string {
  if (!detail) return fallback;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => (typeof item === 'string' ? item : item?.msg || JSON.stringify(item)))
      .join(' · ');
  }
  if (typeof detail === 'object') {
    const value = detail as Json;
    if (Array.isArray(value.errors) && value.errors.length) {
      return `${value.message || fallback}: ${value.errors.join(' · ')}`;
    }
    if (value.message) return String(value.message);
    if (value.detail) return errorDetailMessage(value.detail, fallback);
  }
  return fallback;
}

export class ApiClient {
  private static token: string | null = localStorage.getItem(TOKEN_KEY);

  static getToken(): string | null {
    return this.token;
  }

  static setToken(token: string) {
    this.token = token;
    localStorage.setItem(TOKEN_KEY, token);
  }

  static clearToken() {
    this.token = null;
    localStorage.removeItem(TOKEN_KEY);
  }

  static getHeaders(json = true): HeadersInit {
    const headers: Record<string, string> = {};
    if (json) headers['Content-Type'] = 'application/json';
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    return headers;
  }

  private static async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...this.getHeaders(!(init.body instanceof FormData)),
        ...(init.headers || {}),
      },
    });

    if (response.status === 401) {
      this.clearToken();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('neurolab:unauthorized'));
      }
    }

    if (!response.ok) {
      let body: any = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      throw new ApiError(
        errorDetailMessage(body?.detail, `Error HTTP ${response.status}`),
        response.status,
        body?.detail,
      );
    }

    if (response.status === 204) return undefined as T;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) return (await response.json()) as T;
    return (await response.text()) as unknown as T;
  }

  // ---------------------------------------------------------------- Auth
  static async login(email: string, password: string) {
    const raw = await this.request<Json>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    this.setToken(raw.access_token);
    return { user: normalizeUser(raw.user), expiresIn: raw.expires_in };
  }

  static async me(): Promise<User> {
    return normalizeUser(await this.request<Json>('/auth/me'));
  }

  static async changePassword(currentPassword: string, newPassword: string) {
    return this.request<{ message: string }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
  }

  // ------------------------------------------------------------ Projects
  static async listProjects(): Promise<Project[]> {
    const data = await this.request<Json[]>('/projects');
    return data.map(normalizeProject);
  }

  static async createProject(
    name: string,
    description?: string,
    networkFamily: string = 'FEEDFORWARD',
  ): Promise<Project> {
    const data = await this.request<Json>('/projects', {
      method: 'POST',
      body: JSON.stringify({
        name,
        description: description || null,
        network_family: networkFamily,
      }),
    });
    return normalizeProject(data);
  }

  static async updateProject(
    projectId: string,
    payload: { name?: string; description?: string; status?: string; networkFamily?: string },
  ): Promise<Project> {
    const { networkFamily, ...rest } = payload;
    const data = await this.request<Json>(`/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...rest,
        ...(networkFamily ? { network_family: networkFamily } : {}),
      }),
    });
    return normalizeProject(data);
  }

  static async listMembers(projectId: string): Promise<ProjectMember[]> {
    const data = await this.request<Json[]>(`/projects/${projectId}/members`);
    return data.map((raw) => ({
      projectId: raw.project_id,
      userId: raw.user_id,
      role: raw.role,
      addedAt: raw.added_at,
      email: raw.email,
      displayName: raw.display_name,
    }));
  }

  static async addMember(projectId: string, email: string, role: UserRole) {
    return this.request(`/projects/${projectId}/members`, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    });
  }

  // -------------------------------------------------------- Architectures
  static async validateArchitecture(
    projectId: string,
    topology: NetworkTopology,
    family: string,
  ): Promise<ArchitectureValidationResult> {
    const raw = await this.request<Json>(
      `/projects/${projectId}/architectures/validate?family=${encodeURIComponent(family)}`,
      { method: 'POST', body: JSON.stringify(toApiTopology(topology)) },
    );
    return {
      valid: raw.valid,
      totalParameters: raw.total_parameters ?? 0,
      trainableParameters: raw.trainable_parameters ?? 0,
      outputShape: raw.output_shape || [],
      warnings: raw.warnings || [],
      errors: raw.errors || [],
      trainable: raw.trainable ?? raw.valid,
      trainableReason: raw.trainable_reason || undefined,
    };
  }

  static async listArchitectures(projectId: string): Promise<Architecture[]> {
    const data = await this.request<Json[]>(`/projects/${projectId}/architectures`);
    return data.map(normalizeArchitecture);
  }

  static async createArchitecture(
    projectId: string,
    name: string,
    family: string,
    topology: NetworkTopology,
  ): Promise<Architecture> {
    const data = await this.request<Json>(`/projects/${projectId}/architectures`, {
      method: 'POST',
      body: JSON.stringify({
        name,
        family,
        config_json: toApiTopology(topology),
      }),
    });
    return normalizeArchitecture(data);
  }

  // -------------------------------------------------------------- Datasets
  static async listDatasets(projectId: string): Promise<Dataset[]> {
    const data = await this.request<Json[]>(`/projects/${projectId}/datasets`);
    return data.map(normalizeDataset);
  }

  static async uploadDataset(
    projectId: string,
    file: File,
    name?: string,
    targetColumn?: string,
  ): Promise<Dataset> {
    const form = new FormData();
    form.append('file', file);
    if (name) form.append('name', name);
    if (targetColumn) form.append('target_column', targetColumn);
    const data = await this.request<Json>(`/projects/${projectId}/datasets/upload`, {
      method: 'POST',
      body: form,
    });
    return normalizeDataset(data);
  }

  static async previewDataset(projectId: string, datasetId: string): Promise<DatasetPreview> {
    const raw = await this.request<Json>(`/projects/${projectId}/datasets/${datasetId}/preview`);
    return normalizeDatasetPreview(raw);
  }

  static async deleteDataset(projectId: string, datasetId: string): Promise<void> {
    await this.request(`/projects/${projectId}/datasets/${datasetId}`, { method: 'DELETE' });
  }

  // ------------------------------------------------------------- Training
  static async listTrainingJobs(projectId: string): Promise<TrainingJob[]> {
    const data = await this.request<Json[]>(`/projects/${projectId}/training-jobs`);
    return data.map(normalizeTrainingJob);
  }

  static async getTrainingJob(jobId: string): Promise<TrainingJob> {
    return normalizeTrainingJob(await this.request<Json>(`/training-jobs/${jobId}`));
  }

  static async startTraining(
    projectId: string,
    payload: {
      architectureId: string;
      datasetId: string;
      targetColumn?: string;
      task?: string;
      epochs: number;
      batchSize: number;
      optimizer: string;
      learningRate: number;
    },
  ): Promise<TrainingJob> {
    const data = await this.request<Json>(`/projects/${projectId}/training-jobs`, {
      method: 'POST',
      body: JSON.stringify({
        architecture_id: payload.architectureId,
        dataset_id: payload.datasetId,
        target_column: payload.targetColumn || null,
        task: payload.task || null,
        hyperparameters: {
          epochs: payload.epochs,
          batch_size: payload.batchSize,
          optimizer: payload.optimizer,
          learning_rate: payload.learningRate,
        },
      }),
    });
    return normalizeTrainingJob(data);
  }

  static async cancelTraining(
    jobId: string,
  ): Promise<{ message: string; status: string; cancel_requested: boolean }> {
    return this.request(`/training-jobs/${jobId}/cancel`, { method: 'POST' });
  }

  static async createJobEventsUrl(jobId: string): Promise<string> {
    const data = await this.request<{ ticket: string; expires_in: number }>(
      `/training-jobs/${jobId}/events-ticket`,
      { method: 'POST' },
    );
    return `${API_BASE}/training-jobs/${jobId}/events?ticket=${encodeURIComponent(data.ticket)}`;
  }

  // --------------------------------------------------------------- Models
  static async listModels(projectId: string): Promise<ModelVersion[]> {
    const data = await this.request<Json[]>(`/projects/${projectId}/models`);
    return data.map(normalizeModelVersion);
  }

  static async updateModelStatus(
    modelId: string,
    status: ModelLifecycleStatus,
    reason?: string,
  ): Promise<ModelVersion> {
    const data = await this.request<Json>(`/models/${modelId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, reason: reason || null }),
    });
    return normalizeModelVersion(data);
  }

  static async downloadModel(modelId: string): Promise<{ blob: Blob; filename: string }> {
    const response = await fetch(`${API_BASE}/models/${modelId}/download`, {
      headers: this.getHeaders(false),
    });
    if (!response.ok) {
      let detail: unknown = null;
      try {
        detail = (await response.json())?.detail;
      } catch {
        detail = null;
      }
      throw new ApiError(
        errorDetailMessage(detail, `No fue posible descargar el artefacto (${response.status})`),
        response.status,
        detail,
      );
    }
    const disposition = response.headers.get('content-disposition') || '';
    const match = /filename="?([^";]+)"?/i.exec(disposition);
    return { blob: await response.blob(), filename: match?.[1] || 'model.keras' };
  }

  static async predictModel(
    modelId: string,
    records: Record<string, unknown>[],
    threshold?: number,
  ): Promise<PredictionResult> {
    const raw = await this.request<Json>(`/models/${modelId}/predict`, {
      method: 'POST',
      body: JSON.stringify({ records, ...(threshold != null ? { threshold } : {}) }),
    });
    return {
      modelId: raw.model_id,
      modelVersion: raw.model_version,
      modelStatus: raw.model_status,
      task: raw.task,
      targetColumn: raw.target_column,
      classLabels: raw.class_labels || [],
      decisionThreshold: raw.decision_threshold,
      predictions: (raw.predictions || []).map((item: Json) => ({
        index: item.index,
        prediction: item.prediction,
        label: item.label,
        probability: item.probability,
        probabilities: item.probabilities,
        threshold: item.threshold,
      })),
      warnings: raw.warnings || [],
    };
  }

  static async getModelCard(modelId: string): Promise<string> {
    return this.request<string>(`/models/${modelId}/card`);
  }

  // ---------------------------------------------------------------- Audit
  static async listAuditEvents(
    projectId: string,
    action?: string,
    limit = 100,
  ): Promise<AuditEvent[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (action) params.set('action', action);
    const data = await this.request<Json[]>(
      `/projects/${projectId}/audit-events?${params.toString()}`,
    );
    return data.map(normalizeAuditEvent);
  }

  // ---------------------------------------------------------------- Admin
  static async listUsers(): Promise<User[]> {
    const data = await this.request<Json[]>('/admin/users');
    return data.map(normalizeUser);
  }

  static async createUser(payload: {
    email: string;
    password: string;
    displayName: string;
    role: UserRole;
  }): Promise<User> {
    const data = await this.request<Json>('/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email: payload.email,
        password: payload.password,
        display_name: payload.displayName,
        role: payload.role,
      }),
    });
    return normalizeUser(data);
  }

  static async updateUser(
    userId: string,
    payload: { displayName?: string; role?: UserRole; status?: string },
  ): Promise<User> {
    const body: Json = {};
    if (payload.displayName !== undefined) body.display_name = payload.displayName;
    if (payload.role !== undefined) body.role = payload.role;
    if (payload.status !== undefined) body.status = payload.status;
    const data = await this.request<Json>(`/admin/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return normalizeUser(data);
  }

  static async systemStatus(): Promise<SystemStatus> {
    const raw = await this.request<Json>('/admin/system');
    return {
      status: raw.status,
      environment: raw.environment,
      version: raw.version,
      database: raw.database,
      redis: raw.redis,
      queueBackend: raw.queue_backend,
      limits: raw.limits || {},
      uptimeSeconds: raw.uptime_seconds ?? 0,
    };
  }

  // --------------------------------------------------------- Fundamentals
  static async getFundamentals(): Promise<Json | null> {
    try {
      return await this.request<Json>('/fundamentals');
    } catch {
      return null;
    }
  }
}
