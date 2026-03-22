import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => ({
    summaries: [],
    recent: [],
    operations: [],
  })),
}));

import {
  clearFrontendPerf,
  getFrontendPerfSnapshot,
  measureAsync,
  measureSync,
  withPerfOperation,
} from "./perf";

describe("perf aggregation", () => {
  beforeEach(() => {
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
});
