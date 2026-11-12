// ==========================================
// NEUROLAB ENTERPRISE - TYPE DEFINITIONS
// ==========================================

export type UserRole = 'ADMIN' | 'PROJECT_LEAD' | 'AI_ENGINEER' | 'REVIEWER' | 'VIEWER';

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | string;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  status: 'ACTIVE' | 'ARCHIVED' | string;
  /** Familia de red elegida al crear el proyecto (valor por defecto del diseñador). */
  networkFamily: NetworkFamily;
  createdAt: string;
  updatedAt: string;
  architecturesCount: number;
  datasetsCount: number;
  jobsCount: number;
  effectiveRole?: UserRole | string;
}

export interface ProjectMember {
  projectId: string;
  userId: string;
  role: UserRole | string;
  addedAt: string;
  email?: string;
  displayName?: string;
}

export type NetworkFamily = 'FEEDFORWARD' | 'RNN' | 'CNN' | 'GAN';

export type LayerType =
  | 'Dense'
  | 'Dropout'
  | 'Conv1D'
  | 'Conv2D'
  | 'MaxPooling1D'
  | 'MaxPooling2D'
  | 'Flatten'
  | 'LSTM'
  | 'GRU'
  | 'SimpleRNN'
  | 'BatchNormalization';

export type ActivationFunction =
  | 'relu'
  | 'sigmoid'
  | 'tanh'
  | 'softmax'
  | 'linear'
  | 'elu'
  | 'swish';

export interface LayerConfig {
  id?: string;
  type: LayerType;
  units?: number;
  activation?: ActivationFunction;
  rate?: number;
  filters?: number;
  kernelSize?: number[];
  poolSize?: number[];
  returnSequences?: boolean;
}

export interface NetworkTopology {
  inputShape: number[];
  layers: LayerConfig[];
}

export interface Architecture {
  id: string;
  projectId: string;
  name: string;
  family: NetworkFamily;
  config: NetworkTopology;
  version: number;
  createdAt: string;
}

export interface ArchitectureValidationResult {
  valid: boolean;
  totalParameters: number;
  trainableParameters: number;
  outputShape: (number | null)[];
  warnings: string[];
  errors: string[];
  trainable: boolean;
  trainableReason?: string;
}

export interface DatasetColumn {
  name: string;
  dtype: string;
  nullCount: number;
  unique: number;
}

export interface DatasetFeatureBreakdown {
  name: string;
  kind: 'numeric' | 'one_hot' | 'ordinal' | string;
  neurons: number;
  values?: string[];
}

/** Neuronas reales que tendrá el modelo con este CSV (calculadas por la API). */
export interface DatasetNeuronSummary {
  available: boolean;
  reason?: string;
  inputNeurons: number;
  outputNeurons: number;
  outputActivation?: ActivationFunction;
  loss?: string;
  classLabels: string[];
  classCount: number;
  features: DatasetFeatureBreakdown[];
  truncated?: boolean;
}

export interface DatasetMetadata {
  samples: number;
  featuresCount: number;
  targetColumn?: string;
  task?: 'classification' | 'regression';
  neurons?: DatasetNeuronSummary;
  columns: DatasetColumn[];
  nullCounts: Record<string, number>;
  dtypes: Record<string, string>;
  trainSplit: number;
  valSplit: number;
  testSplit: number;
  verified?: boolean;
}

export interface Dataset {
  id: string;
  projectId: string;
  name: string;
  version: string;
  storageKey: string;
  originalFilename?: string;
  sizeBytes: number;
  checksum?: string;
  targetColumn?: string;
  verified: boolean;
  metadata: DatasetMetadata;
  createdAt: string;
}

export interface DatasetPreview {
  id: string;
  columns: string[];
  dtypes: Record<string, string>;
  rows: Record<string, string | number | boolean | null>[];
  totalRows: number;
  nullCounts: Record<string, number>;
}

export type JobStatus = 'QUEUED' | 'PREPARING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface Hyperparameters {
  epochs: number;
  batchSize: number;
  optimizer: 'adam' | 'sgd' | 'rmsprop' | 'adamw' | 'nadam';
  learningRate: number;
  loss?: string;
  metrics?: string[];
  randomSeed?: number;
  validationSplit?: number;
  targetColumn?: string;
  task?: string;
}

export interface TrainingMetric {
  epoch: number;
  loss?: number;
  accuracy?: number;
  valLoss?: number;
  valAccuracy?: number;
  precision?: number;
  recall?: number;
  mae?: number;
  [key: string]: number | undefined;
}

export interface TrainingJob {
  id: string;
  projectId: string;
  architectureId: string;
  datasetId: string;
  status: JobStatus;
  progress: number;
  hyperparameters: Hyperparameters;
  cancelRequested: boolean;
  startedAt?: string;
  endedAt?: string;
  errorMessage?: string;
  createdAt: string;
  metrics: TrainingMetric[];
}

export type ModelLifecycleStatus = 'DRAFT' | 'REVIEWED' | 'APPROVED' | 'RETIRED';

export interface ModelInputField {
  name: string;
  kind: 'numeric' | 'categorical';
  nullable?: boolean;
  min?: number | null;
  max?: number | null;
  median?: number | null;
  values?: string[];
  truncated?: boolean;
}

export interface BaselineComparison {
  available: boolean;
  metric?: string;
  modelScore?: number;
  bestBaseline?: string;
  bestBaselineScore?: number;
  delta?: number;
  beatsBaseline?: boolean;
}

export interface ModelMetrics {
  accuracy?: number;
  loss?: number;
  valAccuracy?: number;
  valLoss?: number;
  f1Score?: number;
  testAccuracy?: number;
  testLoss?: number;
  precision?: number;
  recall?: number;
  testMse?: number;
  testRmse?: number;
  testMae?: number;
  r2Score?: number;
  rocAuc?: number;
  prAuc?: number;
  balancedAccuracy?: number;
  decisionThreshold?: number;
  confusionMatrix?: number[][];
  classLabels?: (string | number)[];
  epochsCompleted?: number;
  samplesTest?: number;
  task?: string;
  artifacts?: Record<string, string>;
  datasetChecksum?: string;
  datasetVersion?: string;
  inputSchema?: ModelInputField[];
  featureColumns?: string[];
  baselineComparison?: BaselineComparison;
}

export interface PredictionItem {
  index: number;
  prediction: string | number;
  label?: string | null;
  probability?: number | null;
  probabilities?: Record<string, number> | null;
  threshold?: number | null;
}

export interface PredictionResult {
  modelId: string;
  modelVersion: string;
  modelStatus: string;
  task: string;
  targetColumn?: string | null;
  classLabels: string[];
  decisionThreshold?: number | null;
  predictions: PredictionItem[];
  warnings: string[];
}

export interface ModelVersion {
  id: string;
  projectId: string;
  jobId: string;
  version: string;
  storageKey: string;
  status: ModelLifecycleStatus;
  checksum: string;
  metricsSummary: ModelMetrics | null;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  actorId?: string;
  actorName?: string;
  projectId?: string;
  action: string;
  metadata: Record<string, any>;
  createdAt: string;
}

export interface SystemStatus {
  status: string;
  environment: string;
  version: string;
  database: string;
  redis: string;
  queueBackend: string;
  limits: Record<string, number>;
  uptimeSeconds: number;
}
