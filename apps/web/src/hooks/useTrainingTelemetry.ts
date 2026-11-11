import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient } from '../lib/api';
import { JobStatus, TrainingMetric } from '../types';

const TERMINAL_STATES: JobStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

interface TelemetryOptions {
  totalEpochs?: number;
  initialMetrics?: TrainingMetric[];
  initialStatus?: JobStatus | null;
  initialProgress?: number;
  pollIntervalMs?: number;
}

interface JobSnapshot {
  id: string;
  status: JobStatus;
  progress: number;
  cancel_requested?: boolean;
  error_message?: string | null;
  metrics_history?: Record<string, unknown>[];
}

function normalizeMetricKey(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
}

function normalizeMetricRow(row: Record<string, unknown>): TrainingMetric {
  const point: TrainingMetric = { epoch: Number(row.epoch ?? 0) };
  Object.entries(row).forEach(([key, value]) => {
    if (key === 'epoch') return;
    if (typeof value === 'number' && Number.isFinite(value)) {
      point[normalizeMetricKey(key)] = value;
    }
  });
  return point;
}

function mergeMetrics(
  current: TrainingMetric[],
  incoming: TrainingMetric[],
): TrainingMetric[] {
  if (!incoming.length) return current;
  const byEpoch = new Map<number, TrainingMetric>();
  current.forEach((point) => byEpoch.set(point.epoch, point));
  incoming.forEach((point) => {
    byEpoch.set(point.epoch, { ...(byEpoch.get(point.epoch) || { epoch: point.epoch }), ...point });
  });
  return Array.from(byEpoch.values()).sort((a, b) => a.epoch - b.epoch);
}

function maxEpoch(metrics: TrainingMetric[]): number {
  return metrics.reduce((max, point) => Math.max(max, point.epoch), 0);
}

export function useTrainingTelemetry(jobId: string | null, options: TelemetryOptions = {}) {
  const {
    totalEpochs: optionTotalEpochs,
    initialMetrics = [],
    initialStatus = null,
    initialProgress = 0,
    pollIntervalMs = 5000,
  } = options;

  const [metrics, setMetrics] = useState<TrainingMetric[]>(initialMetrics);
  const [status, setStatus] = useState<JobStatus | null>(initialStatus);
  const [progress, setProgress] = useState(initialProgress);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);

  const statusRef = useRef<JobStatus | null>(initialStatus);
  const metricsRef = useRef<TrainingMetric[]>(initialMetrics);
  const totalEpochsRef = useRef<number>(optionTotalEpochs ?? 0);

  useEffect(() => {
    metricsRef.current = metrics;
  }, [metrics]);

  useEffect(() => {
    totalEpochsRef.current = optionTotalEpochs ?? 0;
  }, [optionTotalEpochs]);

  const commitStatus = useCallback((nextStatus: JobStatus | null, nextError?: string | null) => {
    if (!nextStatus) return;
    statusRef.current = nextStatus;
    setStatus(nextStatus);
    if (nextError !== undefined) setErrorMessage(nextError);
    if (nextStatus === 'COMPLETED') setProgress(100);
  }, []);

  const appendMetrics = useCallback((incoming: TrainingMetric[]) => {
    setMetrics((current) => {
      const merged = mergeMetrics(current, incoming);
      metricsRef.current = merged;
      return merged;
    });
  }, []);

  const replaceMetrics = useCallback((incoming: TrainingMetric[]) => {
    if (!incoming.length) return;
    setMetrics((current) => {
      const merged = mergeMetrics(current, incoming);
      metricsRef.current = merged;
      return merged;
    });
  }, []);

  const applySnapshot = useCallback(
    (snapshot: JobSnapshot) => {
      if (snapshot.metrics_history?.length) {
        replaceMetrics(snapshot.metrics_history.map(normalizeMetricRow));
      }
      if (typeof snapshot.progress === 'number') {
        setProgress(snapshot.status === 'COMPLETED' ? 100 : snapshot.progress);
      }
      setErrorMessage(snapshot.error_message ?? null);
      commitStatus(snapshot.status, snapshot.error_message ?? null);
    },
    [commitStatus, replaceMetrics],
  );

  const refresh = useCallback(async () => {
    if (!jobId) return;
    try {
      const job = await ApiClient.getTrainingJob(jobId);
      if (job.metrics.length) replaceMetrics(job.metrics);
      setProgress(job.status === 'COMPLETED' ? 100 : job.progress);
      commitStatus(job.status, job.errorMessage ?? null);
      setLastEventAt(Date.now());
    } catch {
      // El sondeo es un mecanismo de recuperación; un fallo puntual no debe
      // borrar la telemetría ya recibida por SSE.
    }
  }, [jobId, commitStatus, replaceMetrics]);

  // Reset al cambiar de trabajo y recuperación inicial desde PostgreSQL.
  useEffect(() => {
    statusRef.current = initialStatus;
    metricsRef.current = initialMetrics;
    setMetrics(initialMetrics);
    setStatus(initialStatus);
    setProgress(initialStatus === 'COMPLETED' ? 100 : initialProgress);
    setErrorMessage(null);
    setIsConnected(false);
    setLastEventAt(null);
    if (jobId && !initialMetrics.length) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // Canal primario SSE con eventos nombrados. El JWT no viaja en la URL:
  // primero se canjea por un ticket de un solo uso.
  useEffect(() => {
    if (!jobId || typeof EventSource === 'undefined') return;
    if (statusRef.current && TERMINAL_STATES.includes(statusRef.current)) return;

    let source: EventSource | null = null;
    let closed = false;

    const close = () => {
      closed = true;
      source?.close();
      setIsConnected(false);
    };

    const connect = async () => {
      let url: string;
      try {
        url = await ApiClient.createJobEventsUrl(jobId);
      } catch {
        setIsConnected(false);
        return;
      }
      if (closed) return;

      source = new EventSource(url);

      source.onopen = () => {
        setIsConnected(true);
      };

      source.addEventListener('snapshot', (event) => {
        const payload = JSON.parse((event as MessageEvent).data) as { job: JobSnapshot };
        if (payload.job) {
          applySnapshot(payload.job);
          if (TERMINAL_STATES.includes(payload.job.status)) close();
        }
        setLastEventAt(Date.now());
      });

      source.addEventListener('epoch_end', (event) => {
        const payload = JSON.parse((event as MessageEvent).data) as {
          epoch: number;
          total_epochs: number;
          progress: number;
          metrics: Record<string, number>;
        };
        if (payload.total_epochs) totalEpochsRef.current = payload.total_epochs;
        const point = normalizeMetricRow({ epoch: payload.epoch, ...payload.metrics });
        appendMetrics([point]);
        if (typeof payload.progress === 'number') setProgress(payload.progress);
        setLastEventAt(Date.now());
      });

      source.addEventListener('metrics', (event) => {
        const payload = JSON.parse((event as MessageEvent).data) as {
          status: JobStatus;
          progress: number;
          metrics: Record<string, unknown>[];
        };
        appendMetrics((payload.metrics || []).map(normalizeMetricRow));
        if (typeof payload.progress === 'number') setProgress(payload.progress);
        if (payload.status) commitStatus(payload.status);
        setLastEventAt(Date.now());
      });

      source.addEventListener('state', (event) => {
        const payload = JSON.parse((event as MessageEvent).data) as {
          status: JobStatus;
          progress: number;
          error_message?: string | null;
          metrics_history?: Record<string, unknown>[];
        };
        if (payload.metrics_history?.length) {
          replaceMetrics(payload.metrics_history.map(normalizeMetricRow));
        }
        if (typeof payload.progress === 'number') setProgress(payload.progress);
        commitStatus(payload.status, payload.error_message ?? null);
        setLastEventAt(Date.now());
        if (TERMINAL_STATES.includes(payload.status)) close();
      });

      source.addEventListener('error', (event) => {
        // Dos casos: evento de negocio `error` del backend o fallo de red del
        // EventSource. Sólo el primero trae `data`.
        const data = (event as MessageEvent).data;
        if (data) {
          try {
            const payload = JSON.parse(data) as { detail?: string };
            if (payload.detail) setErrorMessage(payload.detail);
          } catch {
            setErrorMessage('El canal de telemetría reportó un error');
          }
          close();
        } else {
          setIsConnected(false);
        }
      });
    };

    void connect();

    return () => {
      closed = true;
      source?.close();
      setIsConnected(false);
    };
  }, [jobId, applySnapshot, appendMetrics, replaceMetrics, commitStatus]);

  // Respaldo: sondeo a PostgreSQL mientras el trabajo sigue activo. Cubre
  // reconexiones, navegadores sin EventSource y caídas de Redis.
  useEffect(() => {
    if (!jobId) return;
    if (statusRef.current && TERMINAL_STATES.includes(statusRef.current)) return;

    const interval = window.setInterval(() => {
      if (statusRef.current && TERMINAL_STATES.includes(statusRef.current)) {
        window.clearInterval(interval);
        return;
      }
      void refresh();
    }, pollIntervalMs);

    return () => window.clearInterval(interval);
  }, [jobId, pollIntervalMs, refresh]);

  const currentEpoch = useMemo(() => {
    const observed = maxEpoch(metrics);
    if (status === 'COMPLETED' && totalEpochsRef.current > 0) {
      return Math.max(observed, totalEpochsRef.current);
    }
    return observed;
  }, [metrics, status]);

  const totalEpochs = optionTotalEpochs ?? Math.max(currentEpoch, totalEpochsRef.current);

  return {
    metrics,
    progress,
    currentEpoch,
    totalEpochs,
    status,
    errorMessage,
    isConnected,
    lastEventAt,
    refresh,
  };
}
