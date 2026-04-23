import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface CapturedLexicalEditorProps {
  readonly onTextChange: (text: string) => void;
}

const lexicalEditorPaneState = vi.hoisted(() => ({
  props: null as CapturedLexicalEditorProps | null,
}));

vi.mock("../../lexical/markdown-editor", () => ({
  LexicalMarkdownEditor: (props: CapturedLexicalEditorProps) => {
    lexicalEditorPaneState.props = props;
    return null;
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  lexicalEditorPaneState.props = null;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("LexicalEditorPane renderer registration", () => {
  it("registers decorator renderers in the production pane entrypoint", async () => {
    vi.useRealTimers();
    vi.resetModules();
    const registry = await import("../../lexical/nodes/renderer-registry");
    registry._resetRenderersForTest();

    expect(registry._hasRegisteredRenderersForTest()).toBe(false);

    await import("./lexical-editor-pane");

    expect(registry._hasRegisteredRenderersForTest()).toBe(true);
  });
});

describe("LexicalEditorPane derived state scheduling", () => {
  it("delays live counts and semantic derivation after rich text changes", async () => {
    const { LexicalEditorPane } = await import("./lexical-editor-pane");
    const { useEditorTelemetryStore } = await import("../stores/editor-telemetry-store");
    const onHeadingsChange = vi.fn();
    const onDiagnosticsChange = vi.fn();
    useEditorTelemetryStore.getState().reset();

    render(
      <LexicalEditorPane
        doc="# Initial\n\none two"
        onDiagnosticsChange={onDiagnosticsChange}
        onHeadingsChange={onHeadingsChange}
      />,
    );

    expect(onHeadingsChange).toHaveBeenCalledWith([
      expect.objectContaining({ text: expect.stringContaining("Initial") }),
    ]);
    const initialWordCount = useEditorTelemetryStore.getState().wordCount;
    expect(initialWordCount).toBeGreaterThan(0);

    onHeadingsChange.mockClear();
    onDiagnosticsChange.mockClear();

    act(() => {
      lexicalEditorPaneState.props?.onTextChange("# Updated\n\none two three four");
    });

    expect(onHeadingsChange).not.toHaveBeenCalled();
    expect(onDiagnosticsChange).not.toHaveBeenCalled();
    expect(useEditorTelemetryStore.getState().wordCount).toBe(initialWordCount);

    act(() => {
      vi.advanceTimersByTime(LEXICAL_TEST_LIVE_DEBOUNCE_MS - 1);
    });
    expect(useEditorTelemetryStore.getState().wordCount).toBe(initialWordCount);
    expect(onHeadingsChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(useEditorTelemetryStore.getState().wordCount).toBeGreaterThan(initialWordCount);
    expect(onHeadingsChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(onHeadingsChange).toHaveBeenCalledWith([
      expect.objectContaining({ text: expect.stringContaining("Updated") }),
    ]);
    expect(onDiagnosticsChange).not.toHaveBeenCalled();
  });

  it("keeps only the latest scheduled semantic result", async () => {
    const { LexicalEditorPane } = await import("./lexical-editor-pane");
    const { useEditorTelemetryStore } = await import("../stores/editor-telemetry-store");
    const onHeadingsChange = vi.fn();
    useEditorTelemetryStore.getState().reset();

    render(
      <LexicalEditorPane
        doc="# Initial\n"
        onHeadingsChange={onHeadingsChange}
      />,
    );

    onHeadingsChange.mockClear();

    act(() => {
      lexicalEditorPaneState.props?.onTextChange("# First\n");
      vi.advanceTimersByTime(300);
      lexicalEditorPaneState.props?.onTextChange("# Second\n");
      vi.advanceTimersByTime(316);
    });

    expect(onHeadingsChange).toHaveBeenCalledTimes(1);
    expect(onHeadingsChange).toHaveBeenCalledWith([
      expect.objectContaining({ text: expect.stringContaining("Second") }),
    ]);
  });

  it("skips diagnostics derivation when diagnostics callback is absent", async () => {
    vi.resetModules();
    const perf = await import("../perf");
    const measureSyncSpy = vi.spyOn(perf, "measureSync");
    const { LexicalEditorPane } = await import("./lexical-editor-pane");
    const onHeadingsChange = vi.fn();

    render(
      <LexicalEditorPane
        docPath="notes/no-diagnostics.md"
        doc="# Initial\n\none two"
        onHeadingsChange={onHeadingsChange}
      />,
    );

    const initialDiagnosticsCalls = countPerfCalls(
      measureSyncSpy,
      "lexical.deriveDiagnostics",
    );
    onHeadingsChange.mockClear();

    act(() => {
      lexicalEditorPaneState.props?.onTextChange("# Updated\n\none two three four");
      vi.advanceTimersByTime(LEXICAL_TEST_LIVE_DEBOUNCE_MS);
      vi.advanceTimersByTime(16);
    });

    expect(onHeadingsChange).toHaveBeenCalledWith([
      expect.objectContaining({ text: expect.stringContaining("Updated") }),
    ]);
    expect(countPerfCalls(
      measureSyncSpy,
      "lexical.deriveDiagnostics",
    )).toBe(initialDiagnosticsCalls);
    expect(countPerfCalls(
      measureSyncSpy,
      "lexical.deriveDocumentAnalysis",
    )).toBeGreaterThan(0);
  });

  it("publishes current diagnostics from the current unsaved doc when the diagnostics callback appears", async () => {
    vi.resetModules();
    const { LexicalEditorPane } = await import("./lexical-editor-pane");
    const diagnostics = vi.fn();
    const view = render(
      <LexicalEditorPane
        doc="# Initial\n\none two"
      />,
    );

    expect(diagnostics).not.toHaveBeenCalled();

    act(() => {
      lexicalEditorPaneState.props?.onTextChange("# Initial\n\nSee [@sec:missing].");
    });

    view.rerender(
      <LexicalEditorPane
        doc="# Initial\n\none two"
        onDiagnosticsChange={diagnostics}
      />,
    );

    expect(diagnostics).toHaveBeenCalledWith([
      expect.objectContaining({
        message: "Unresolved reference \"@sec:missing\"",
      }),
    ]);
  });

  it("resets cached semantic publication when the doc path changes but the saved doc text does not", async () => {
    vi.resetModules();
    const { LexicalEditorPane } = await import("./lexical-editor-pane");
    const diagnostics = vi.fn();
    const view = render(
      <LexicalEditorPane
        docPath="notes/a.md"
        doc="# Shared\n\nSee [@sec:one].\n"
      />,
    );

    act(() => {
      lexicalEditorPaneState.props?.onTextChange("# Shared\n\nSee [@sec:edited-a].\n");
    });

    view.rerender(
      <LexicalEditorPane
        docPath="notes/b.md"
        doc="# Shared\n\nSee [@sec:one].\n"
        onDiagnosticsChange={diagnostics}
      />,
    );

    expect(diagnostics).toHaveBeenCalledWith([
      expect.objectContaining({
        message: "Unresolved reference \"@sec:one\"",
      }),
    ]);
  });

  it("keeps citation ids out of lexical diagnostics without bibliography data", async () => {
    vi.resetModules();
    const { LexicalEditorPane } = await import("./lexical-editor-pane");
    const diagnostics = vi.fn();

    render(
      <LexicalEditorPane
        doc="# Intro\n\nSee [@sec:missing] and [@karger2000]."
        onDiagnosticsChange={diagnostics}
      />,
    );

    expect(diagnostics).toHaveBeenLastCalledWith([
      expect.objectContaining({
        message: "Unresolved reference \"@sec:missing\"",
      }),
    ]);
  });

  it("reuses heading and diagnostics projections when shared semantic slices stay unchanged", async () => {
    vi.resetModules();
    const perf = await import("../perf");
    const measureSyncSpy = vi.spyOn(perf, "measureSync");
    const { LexicalEditorPane } = await import("./lexical-editor-pane");
    const onHeadingsChange = vi.fn();
    const onDiagnosticsChange = vi.fn();

    render(
      <LexicalEditorPane
        docPath="notes/shared-slices.md"
        doc={"# Heading\n\nplain body\n\n## Next\n\ntail body\n"}
        onDiagnosticsChange={onDiagnosticsChange}
        onHeadingsChange={onHeadingsChange}
      />,
    );

    expect(onHeadingsChange).toHaveBeenCalledWith([
      expect.objectContaining({ text: "Heading" }),
      expect.objectContaining({ text: "Next" }),
    ]);
    expect(onDiagnosticsChange).toHaveBeenCalledWith([]);

    const initialHeadingDerives = countPerfCalls(measureSyncSpy, "lexical.deriveHeadings");
    const initialDiagnosticDerives = countPerfCalls(measureSyncSpy, "lexical.deriveDiagnostics");
    onHeadingsChange.mockClear();
    onDiagnosticsChange.mockClear();

    act(() => {
      lexicalEditorPaneState.props?.onTextChange(
        "# Heading\n\nplain body\n\n## Next\n\ntail body updated\n",
      );
      vi.advanceTimersByTime(LEXICAL_TEST_LIVE_DEBOUNCE_MS);
      vi.advanceTimersByTime(16);
    });

    expect(onHeadingsChange).not.toHaveBeenCalled();
    expect(onDiagnosticsChange).not.toHaveBeenCalled();
    expect(countPerfCalls(measureSyncSpy, "lexical.deriveDocumentAnalysis")).toBeGreaterThan(1);
    expect(countPerfCalls(measureSyncSpy, "lexical.deriveHeadings")).toBe(initialHeadingDerives);
    expect(countPerfCalls(measureSyncSpy, "lexical.deriveDiagnostics")).toBe(initialDiagnosticDerives);
  });

  it("recomputes diagnostics without republishing headings when only reference slices change", async () => {
    vi.resetModules();
    const perf = await import("../perf");
    const measureSyncSpy = vi.spyOn(perf, "measureSync");
    const { LexicalEditorPane } = await import("./lexical-editor-pane");
    const onHeadingsChange = vi.fn();
    const onDiagnosticsChange = vi.fn();

    render(
      <LexicalEditorPane
        docPath="notes/reference-slices.md"
        doc={"# Heading\n\nSee [@sec:one].\n\n## Next\n\nmore body\n"}
        onDiagnosticsChange={onDiagnosticsChange}
        onHeadingsChange={onHeadingsChange}
      />,
    );

    expect(onHeadingsChange).toHaveBeenCalledWith([
      expect.objectContaining({ text: "Heading" }),
      expect.objectContaining({ text: "Next" }),
    ]);
    expect(onDiagnosticsChange).toHaveBeenCalledWith([
      expect.objectContaining({
        message: "Unresolved reference \"@sec:one\"",
      }),
    ]);

    const initialHeadingDerives = countPerfCalls(measureSyncSpy, "lexical.deriveHeadings");
    const initialDiagnosticDerives = countPerfCalls(measureSyncSpy, "lexical.deriveDiagnostics");
    onHeadingsChange.mockClear();
    onDiagnosticsChange.mockClear();

    act(() => {
      lexicalEditorPaneState.props?.onTextChange(
        "# Heading\n\nSee [@sec:two].\n\n## Next\n\nmore body\n",
      );
      vi.advanceTimersByTime(LEXICAL_TEST_LIVE_DEBOUNCE_MS);
      vi.advanceTimersByTime(16);
    });

    expect(onHeadingsChange).not.toHaveBeenCalled();
    expect(onDiagnosticsChange).toHaveBeenCalledWith([
      expect.objectContaining({
        message: "Unresolved reference \"@sec:two\"",
      }),
    ]);
    expect(countPerfCalls(measureSyncSpy, "lexical.deriveHeadings")).toBe(initialHeadingDerives);
    expect(countPerfCalls(measureSyncSpy, "lexical.deriveDiagnostics")).toBe(initialDiagnosticDerives + 1);
  });

  it("seeds the shared incremental analysis cache for a stable doc path", async () => {
    vi.resetModules();
    const { LexicalEditorPane } = await import("./lexical-editor-pane");
    const {
      clearDocumentAnalysisCache,
      getDocumentAnalysisSnapshot,
    } = await import("../../semantics/incremental/cached-document-analysis");
    const { getDocumentAnalysisRevision } = await import("../../semantics/incremental/engine");
    const docPath = "notes/lexical-cache.md";
    const nextDoc = "# Updated\n\nBody with [@sec:missing].\n";

    clearDocumentAnalysisCache();

    render(
      <LexicalEditorPane
        docPath={docPath}
        doc="# Initial\n\nBody.\n"
        onHeadingsChange={vi.fn()}
      />,
    );

    act(() => {
      lexicalEditorPaneState.props?.onTextChange(nextDoc);
      vi.advanceTimersByTime(LEXICAL_TEST_LIVE_DEBOUNCE_MS);
      vi.advanceTimersByTime(16);
    });

    const cached = getDocumentAnalysisSnapshot(nextDoc, docPath);

    expect(getDocumentAnalysisRevision(cached)).toBe(1);
    expect(cached.references).toHaveLength(1);
  });
});

const LEXICAL_TEST_LIVE_DEBOUNCE_MS = 300;

function countPerfCalls(
  spy: {
    mock: {
      calls: ReadonlyArray<readonly [string, ...unknown[]]>;
    };
  },
  name: string,
): number {
  return spy.mock.calls.filter(([metricName]) => metricName === name).length;
}
