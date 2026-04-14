import { beforeEach, describe, expect, it } from "vitest";

import { useEditorTelemetryStore } from "./editor-telemetry-store";

describe("editor-telemetry-store", () => {
  beforeEach(() => {
    useEditorTelemetryStore.getState().reset();
  });

  it("derives cursor line/col from doc when cursorPos is provided", () => {
    const doc = "line one\nline two\nline three";
    useEditorTelemetryStore.getState().setTelemetry({
      cursorPos: doc.indexOf("two"),
      doc,
    });
    const state = useEditorTelemetryStore.getState();
    expect(state.cursorPos).toBe(doc.indexOf("two"));
    expect(state.cursorLine).toBe(2);
    expect(state.cursorCol).toBe(6);
  });

  it("does not reset cursor line/col when only scroll fields change", () => {
    const doc = "line one\nline two";
    useEditorTelemetryStore.getState().setTelemetry({
      cursorPos: doc.indexOf("two"),
      doc,
    });
    const before = useEditorTelemetryStore.getState();
    expect(before.cursorLine).toBe(2);

    useEditorTelemetryStore.getState().setTelemetry({ scrollTop: 120, viewportFrom: 9 });

    const after = useEditorTelemetryStore.getState();
    expect(after.cursorLine).toBe(2);
    expect(after.cursorCol).toBe(6);
    expect(after.scrollTop).toBe(120);
    expect(after.viewportFrom).toBe(9);
  });

  it("accepts cursor and scroll updates in a single call", () => {
    const doc = "alpha\nbeta\ngamma";
    useEditorTelemetryStore.getState().setTelemetry({
      cursorPos: doc.indexOf("gamma"),
      doc,
      scrollTop: 48,
      viewportFrom: 6,
    });
    const state = useEditorTelemetryStore.getState();
    expect(state.cursorPos).toBe(doc.indexOf("gamma"));
    expect(state.cursorLine).toBe(3);
    expect(state.cursorCol).toBe(1);
    expect(state.scrollTop).toBe(48);
    expect(state.viewportFrom).toBe(6);
  });

  it("keeps cursorPos but falls back to 1/1 for line/col when doc is missing", () => {
    useEditorTelemetryStore.getState().setTelemetry({ cursorPos: 12 });
    const state = useEditorTelemetryStore.getState();
    expect(state.cursorPos).toBe(12);
    expect(state.cursorLine).toBe(1);
    expect(state.cursorCol).toBe(1);
  });

  it("gracefully handles a cursorPos past the end of the doc", () => {
    const doc = "abc";
    useEditorTelemetryStore.getState().setTelemetry({ cursorPos: 999, doc });
    const state = useEditorTelemetryStore.getState();
    expect(state.cursorPos).toBe(999);
    // Best-effort: line/col default to 1/1 on an out-of-range offset.
    expect(state.cursorLine).toBeGreaterThanOrEqual(1);
    expect(state.cursorCol).toBeGreaterThanOrEqual(1);
  });

  it("setLiveCounts updates word and char counts together", () => {
    useEditorTelemetryStore.getState().setLiveCounts(42, 260);
    const state = useEditorTelemetryStore.getState();
    expect(state.wordCount).toBe(42);
    expect(state.charCount).toBe(260);
  });

  it("reset returns the store to its initial state", () => {
    useEditorTelemetryStore.getState().setTelemetry({
      cursorPos: 5,
      doc: "hello world",
      scrollTop: 200,
      viewportFrom: 5,
    });
    useEditorTelemetryStore.getState().setLiveCounts(11, 55);

    useEditorTelemetryStore.getState().reset();

    const state = useEditorTelemetryStore.getState();
    expect(state.cursorPos).toBe(0);
    expect(state.cursorLine).toBe(1);
    expect(state.cursorCol).toBe(1);
    expect(state.scrollTop).toBe(0);
    expect(state.viewportFrom).toBe(0);
    expect(state.wordCount).toBe(0);
    expect(state.charCount).toBe(0);
  });
});
