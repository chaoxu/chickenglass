import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import {
  clearFrontendPerf,
  getBackendPerfSnapshot,
  getFrontendPerfSnapshot,
  measureAsync,
  measureSync,
  withPerfOperation,
} from "./perf";

describe("perf aggregation", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({
      summaries: [],
      recent: [],
      operations: [],
    });
    delete (globalThis as typeof globalThis & { isTauri?: boolean }).isTauri;
    clearFrontendPerf();
  });

  it("aggregates repeated span names", async () => {
    measureSync("editor.create", () => 1, { category: "editor" });
    await measureAsync("editor.create", async () => 2, { category: "editor" });

    const snapshot = getFrontendPerfSnapshot();
    expect(snapshot.summaries).toHaveLength(1);
    expect(snapshot.summaries[0].name).toBe("editor.create");
    expect(snapshot.summaries[0].count).toBe(2);
  });

  it("records operations separately from spans", async () => {
    await withPerfOperation("open_file", async (operation) => {
      await operation.measureAsync("open_file.read", async () => "ok", {
        category: "open_file",
      });
    }, "demo.md");

    const snapshot = getFrontendPerfSnapshot();
    expect(snapshot.operations[0].name).toBe("open_file");
    expect(snapshot.operations[0].detail).toBe("demo.md");
    expect(snapshot.recent[0].name).toBe("open_file.read");
  });

  it("accepts backend perf snapshots with frontend camelCase DTO keys", async () => {
    (globalThis as typeof globalThis & { isTauri?: boolean }).isTauri = true;
    invokeMock.mockResolvedValueOnce({
      summaries: [{
        name: "open_file.read",
        category: "open_file",
        source: "backend",
        count: 1,
        totalMs: 12.5,
        avgMs: 12.5,
        maxMs: 12.5,
        lastMs: 12.5,
        lastEndedAt: 20,
      }],
      recent: [{
        id: "perf-1",
        name: "open_file.read",
        category: "open_file",
        source: "backend",
        durationMs: 12.5,
        startedAt: 7.5,
        endedAt: 20,
        operationName: "open_file",
        detail: "demo.md",
      }],
      operations: [{
        id: "operation-2",
        name: "open_file",
        detail: "demo.md",
        startedAt: 7.5,
        endedAt: 20,
        durationMs: 12.5,
      }],
    });

    const snapshot = await getBackendPerfSnapshot();

    expect(snapshot?.summaries[0].totalMs).toBe(12.5);
    expect(snapshot?.summaries[0]).not.toHaveProperty("total_ms");
    expect(snapshot?.recent[0].durationMs).toBe(12.5);
    expect(snapshot?.recent[0]).not.toHaveProperty("duration_ms");
    expect(snapshot?.operations[0].startedAt).toBe(7.5);
    expect(snapshot?.operations[0]).not.toHaveProperty("started_at");
  });
});
