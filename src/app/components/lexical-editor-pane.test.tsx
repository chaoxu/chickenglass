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
    expect(onDiagnosticsChange).toHaveBeenCalledWith([]);
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
        doc="# Initial\n\none two"
        onHeadingsChange={onHeadingsChange}
      />,
    );

    const initialLabelGraphCalls = countPerfCalls(
      measureSyncSpy,
      "lexical.deriveLabelGraph",
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
      "lexical.deriveLabelGraph",
    )).toBe(initialLabelGraphCalls);
    expect(countPerfCalls(
      measureSyncSpy,
      "lexical.deriveDiagnostics",
    )).toBe(initialDiagnosticsCalls);
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
