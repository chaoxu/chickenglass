// Tauri client modules lazy-imported at call sites to keep them out of
// the browser startup bundle (#446).
import {
  PERF_PANEL_REFRESH_EVENT,
  PERF_PANEL_TOGGLE_EVENT,
} from "../constants";
import {
  clearFrontendPerf,
  getFrontendPerfSnapshot,
  measureAsync,
  type PerfSnapshot,
} from "../lib/perf";

export * from "../lib/perf";

export interface CombinedPerfSnapshot {
  readonly frontend: PerfSnapshot;
  readonly backend: PerfSnapshot | null;
}

function isTauriRuntime(): boolean {
  const tauriGlobal = globalThis as typeof globalThis & {
    __TAURI_INTERNALS__?: unknown;
    isTauri?: boolean;
  };
  return Boolean(tauriGlobal.__TAURI_INTERNALS__) || Boolean(tauriGlobal.isTauri);
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
