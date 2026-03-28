// Tauri client modules lazy-imported at call sites to keep them out of
// the browser startup bundle (#446).
import {
  MAX_PERF_RECORDS,
  MAX_PERF_OPERATIONS,
  PERF_PANEL_TOGGLE_EVENT,
  PERF_PANEL_REFRESH_EVENT,
} from "../constants";

export type PerfSource = "frontend" | "backend";

export interface PerfRecord {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly source: PerfSource;
  readonly durationMs: number;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly operationId?: string;
  readonly operationName?: string;
  readonly detail?: string;
}

export interface PerfSummaryEntry {
  readonly name: string;
  readonly category: string;
  readonly source: PerfSource;
  readonly count: number;
  readonly totalMs: number;
  readonly avgMs: number;
  readonly maxMs: number;
  readonly lastMs: number;
  readonly lastEndedAt: number;
}

export interface PerfOperationEntry {
  readonly id: string;
  readonly name: string;
  readonly detail?: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly durationMs: number;
}

export interface PerfSnapshot {
  readonly summaries: PerfSummaryEntry[];
  readonly recent: PerfRecord[];
  readonly operations: PerfOperationEntry[];
}

export interface CombinedPerfSnapshot {
  readonly frontend: PerfSnapshot;
  readonly backend: PerfSnapshot | null;
}

export interface PerfSpanOptions {
  readonly category?: string;
  readonly detail?: string;
  readonly operation?: {
    readonly id: string;
    readonly name: string;
  };
}

export interface PerfOperationHandle {
  readonly id: string;
  readonly name: string;
  measureAsync: <T>(
    spanName: string,
    task: () => Promise<T>,
    options?: Omit<PerfSpanOptions, "operation">,
  ) => Promise<T>;
  measureSync: <T>(
    spanName: string,
    task: () => T,
    options?: Omit<PerfSpanOptions, "operation">,
  ) => T;
  end: () => void;
}

type MeasurementFinalizer = () => void;

let nextMeasureId = 0;

function isTauriRuntime(): boolean {
  const tauriWindow = window as Window & { __TAURI_INTERNALS__?: unknown };
  return typeof window !== "undefined" && (
    Boolean(tauriWindow.__TAURI_INTERNALS__)
    || Boolean((globalThis as typeof globalThis & { isTauri?: boolean }).isTauri)
  );
}

function inferCategory(name: string, fallback = "app"): string {
  const [prefix] = name.split(".", 1);
  return prefix || fallback;
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function nextMeasurementId(): number {
  nextMeasureId += 1;
  return nextMeasureId;
}

class FrontendPerfStore {
  private readonly summaries = new Map<string, PerfSummaryEntry>();
  private readonly recent: PerfRecord[] = [];
  private readonly operations: PerfOperationEntry[] = [];
  private nextId = 0;

  private nextRecordId(): string {
    this.nextId += 1;
    return `perf-${this.nextId}`;
  }

  recordSpan(
    name: string,
    durationMs: number,
    options: PerfSpanOptions = {},
  ): PerfRecord {
    const endedAt = nowMs();
    const startedAt = endedAt - durationMs;
    const category = options.category ?? inferCategory(name);
    const record: PerfRecord = {
      id: this.nextRecordId(),
      name,
      category,
      source: "frontend",
      durationMs,
      startedAt,
      endedAt,
      operationId: options.operation?.id,
      operationName: options.operation?.name,
      detail: options.detail,
    };

    this.recent.unshift(record);
    if (this.recent.length > MAX_PERF_RECORDS) {
      this.recent.length = MAX_PERF_RECORDS;
    }

    const key = `${record.source}:${category}:${name}`;
    const prev = this.summaries.get(key);
    if (prev) {
      const count = prev.count + 1;
      this.summaries.set(key, {
        ...prev,
        count,
        totalMs: prev.totalMs + durationMs,
        avgMs: (prev.totalMs + durationMs) / count,
        maxMs: Math.max(prev.maxMs, durationMs),
        lastMs: durationMs,
        lastEndedAt: endedAt,
      });
    } else {
      this.summaries.set(key, {
        name,
        category,
        source: "frontend",
        count: 1,
        totalMs: durationMs,
        avgMs: durationMs,
        maxMs: durationMs,
        lastMs: durationMs,
        lastEndedAt: endedAt,
      });
    }

    return record;
  }

  recordOperation(name: string, startedAt: number, detail?: string): PerfOperationEntry {
    const endedAt = nowMs();
    const operation: PerfOperationEntry = {
      id: this.nextRecordId(),
      name,
      detail,
      startedAt,
      endedAt,
      durationMs: endedAt - startedAt,
    };
    this.operations.unshift(operation);
    if (this.operations.length > MAX_PERF_OPERATIONS) {
      this.operations.length = MAX_PERF_OPERATIONS;
    }
    return operation;
  }

  snapshot(): PerfSnapshot {
    return {
      summaries: Array.from(this.summaries.values()).sort((a, b) => b.totalMs - a.totalMs),
      recent: [...this.recent],
      operations: [...this.operations],
    };
  }

  clear(): void {
    this.summaries.clear();
    this.recent.length = 0;
    this.operations.length = 0;
  }
}

const frontendPerfStore = new FrontendPerfStore();

function beginMeasurement(
  name: string,
  options: PerfSpanOptions,
): MeasurementFinalizer {
  const measureId = nextMeasurementId();
  const startMark = `cf:${measureId}:start`;
  const endMark = `cf:${measureId}:end`;
  const measureLabel = `cf:${measureId}:${name}`;
  performance.mark(startMark);

  return () => {
    performance.mark(endMark);
    performance.measure(measureLabel, startMark, endMark);
    const entries = performance.getEntriesByName(measureLabel);
    const durationMs = entries.at(-1)?.duration ?? 0;
    frontendPerfStore.recordSpan(name, durationMs, options);
    performance.clearMarks(startMark);
    performance.clearMarks(endMark);
    performance.clearMeasures(measureLabel);
  };
}

export function measureSync<T>(
  name: string,
  task: () => T,
  options: PerfSpanOptions = {},
): T {
  const finalize = beginMeasurement(name, options);
  try {
    return task();
  } finally {
    finalize();
  }
}

export async function measureAsync<T>(
  name: string,
  task: () => Promise<T>,
  options: PerfSpanOptions = {},
): Promise<T> {
  const finalize = beginMeasurement(name, options);
  try {
    return await task();
  } finally {
    finalize();
  }
}

export async function withPerfOperation<T>(
  name: string,
  task: (operation: PerfOperationHandle) => Promise<T>,
  detail?: string,
): Promise<T> {
  const startedAt = nowMs();
  const operationId = `operation-${Math.random().toString(36).slice(2, 10)}`;
  const operationBase = { id: operationId, name };
  const operation: PerfOperationHandle = {
    ...operationBase,
    measureAsync: (spanName, spanTask, options) =>
      measureAsync(spanName, spanTask, { ...options, operation: operationBase }),
    measureSync: (spanName, spanTask, options) =>
      measureSync(spanName, spanTask, { ...options, operation: operationBase }),
    end: () => {
      frontendPerfStore.recordOperation(name, startedAt, detail);
    },
  };

  try {
    return await task(operation);
  } finally {
    operation.end();
  }
}

export function getFrontendPerfSnapshot(): PerfSnapshot {
  return frontendPerfStore.snapshot();
}

export function clearFrontendPerf(): void {
  frontendPerfStore.clear();
}

export async function getBackendPerfSnapshot(): Promise<PerfSnapshot | null> {
  if (!isTauriRuntime()) return null;
  try {
    const { getPerfSnapshotCommand } = await import("./tauri-client/perf");
    return await getPerfSnapshotCommand();
  } catch (_e) {
    // best-effort: backend perf command may not exist in this runtime
    return null;
  }
}

export async function clearBackendPerf(): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const { clearPerfSnapshotCommand } = await import("./tauri-client/perf");
    await clearPerfSnapshotCommand();
  } catch (_e) {
    // best-effort: backend perf support may be unavailable
  }
}

export async function getCombinedPerfSnapshot(): Promise<CombinedPerfSnapshot> {
  const [frontend, backend] = await Promise.all([
    Promise.resolve(getFrontendPerfSnapshot()),
    getBackendPerfSnapshot(),
  ]);
  return { frontend, backend };
}

export async function clearCombinedPerf(): Promise<void> {
  clearFrontendPerf();
  await clearBackendPerf();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PERF_PANEL_REFRESH_EVENT));
  }
}

export async function printPerfSummary(): Promise<CombinedPerfSnapshot> {
  const snapshot = await getCombinedPerfSnapshot();
  console.table(snapshot.frontend.summaries);
  if (snapshot.backend) {
    console.table(snapshot.backend.summaries);
  }
  return snapshot;
}

export async function invokeWithPerf<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return measureAsync(`tauri.invoke.${command}`, async () => {
    const { invokeTauriCommandRaw } = await import("./tauri-client/core");
    return invokeTauriCommandRaw<T>(command, args);
  }, {
    category: "tauri",
    detail: command,
  });
}

export function togglePerfPanel(): void {
  window.dispatchEvent(new Event(PERF_PANEL_TOGGLE_EVENT));
}

export function perfPanelToggleEventName(): string {
  return PERF_PANEL_TOGGLE_EVENT;
}

export function perfPanelRefreshEventName(): string {
  return PERF_PANEL_REFRESH_EVENT;
}
