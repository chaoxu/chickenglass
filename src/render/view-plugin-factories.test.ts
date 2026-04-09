import { afterEach, describe, expect, it, vi } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import type { EditorState } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  type ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import {
  createCursorSensitiveViewPlugin,
  createSimpleViewPlugin,
  cursorSensitiveShouldUpdate,
  defaultShouldUpdate,
} from "./view-plugin-factories";
import {
  createEditorState,
  createTestView,
  getDecorationSpecs,
} from "../test-utils";
import { programmaticDocumentChangeAnnotation } from "../state/programmatic-document-change";

/**
 * Build a minimal ViewUpdate stub for testing shouldUpdate predicates.
 */
function mockViewUpdate(overrides: Partial<{
  docChanged: boolean;
  selectionSet: boolean;
  focusChanged: boolean;
  viewportChanged: boolean;
  state: EditorState;
  startState: EditorState;
}> = {}): ViewUpdate {
  const state = overrides.state ?? createEditorState("test", { extensions: [markdown()] });
  return {
    docChanged: overrides.docChanged ?? false,
    selectionSet: overrides.selectionSet ?? false,
    focusChanged: overrides.focusChanged ?? false,
    viewportChanged: overrides.viewportChanged ?? false,
    state: overrides.state ?? state,
    startState: overrides.startState ?? state,
  } as unknown as ViewUpdate;
}

describe("createSimpleViewPlugin", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("returns an Extension (non-null, non-undefined)", () => {
    const ext = createSimpleViewPlugin(() => Decoration.none);
    expect(ext).toBeDefined();
  });

  it("can be installed in an EditorView without errors", () => {
    const ext = createSimpleViewPlugin(() => Decoration.none);
    view = createTestView("hello", { extensions: [markdown(), ext] });
    expect(view.state.doc.toString()).toBe("hello");
  });

  it("calls buildFn on construction", () => {
    let callCount = 0;
    const ext = createSimpleViewPlugin(() => {
      callCount++;
      return Decoration.none;
    });
    view = createTestView("test", { extensions: [markdown(), ext] });
    expect(callCount).toBe(1);
  });

  it("calls buildFn on docChanged by default", () => {
    let callCount = 0;
    const ext = createSimpleViewPlugin(() => {
      callCount++;
      return Decoration.none;
    });
    view = createTestView("test", { extensions: [markdown(), ext] });
    callCount = 0;
    view.dispatch({ changes: { from: 0, insert: "x" } });
    expect(callCount).toBe(1);
  });

  it("accepts a custom shouldUpdate that prevents rebuilds", () => {
    let buildCount = 0;
    const ext = createSimpleViewPlugin(
      () => {
        buildCount++;
        return Decoration.none;
      },
      { shouldUpdate: () => false },
    );
    view = createTestView("test", { extensions: [markdown(), ext] });
    buildCount = 0;
    view.dispatch({ changes: { from: 0, insert: "x" } });
    expect(buildCount).toBe(0);
  });

  it("accepts a custom shouldUpdate that always rebuilds", () => {
    let buildCount = 0;
    const ext = createSimpleViewPlugin(
      () => {
        buildCount++;
        return Decoration.none;
      },
      { shouldUpdate: () => true },
    );
    view = createTestView("test", { extensions: [markdown(), ext] });
    buildCount = 0;
    view.dispatch({ changes: { from: 0, insert: "x" } });
    expect(buildCount).toBe(1);
  });
});

describe("defaultShouldUpdate", () => {
  it("returns true when docChanged", () => {
    expect(defaultShouldUpdate(mockViewUpdate({ docChanged: true }))).toBe(true);
  });

  it("returns true when syntax tree changed", () => {
    const state1 = createEditorState("hello", { extensions: [markdown()] });
    const state2 = createEditorState("hello world", { extensions: [markdown()] });
    expect(defaultShouldUpdate(mockViewUpdate({ state: state2, startState: state1 }))).toBe(true);
  });

  it("returns false when only viewportChanged (#577)", () => {
    expect(defaultShouldUpdate(mockViewUpdate({ viewportChanged: true }))).toBe(false);
  });

  it("returns false when only selectionSet", () => {
    expect(defaultShouldUpdate(mockViewUpdate({ selectionSet: true }))).toBe(false);
  });

  it("returns false when only focusChanged", () => {
    expect(defaultShouldUpdate(mockViewUpdate({ focusChanged: true }))).toBe(false);
  });

  it("returns false when nothing changed", () => {
    expect(defaultShouldUpdate(mockViewUpdate())).toBe(false);
  });
});

describe("cursorSensitiveShouldUpdate", () => {
  it("returns true when docChanged", () => {
    expect(cursorSensitiveShouldUpdate(mockViewUpdate({ docChanged: true }))).toBe(true);
  });

  it("returns true when selectionSet", () => {
    expect(cursorSensitiveShouldUpdate(mockViewUpdate({ selectionSet: true }))).toBe(true);
  });

  it("returns true when focusChanged", () => {
    expect(cursorSensitiveShouldUpdate(mockViewUpdate({ focusChanged: true }))).toBe(true);
  });

  it("returns true when viewportChanged (opt-in for visibleRanges plugins)", () => {
    expect(cursorSensitiveShouldUpdate(mockViewUpdate({ viewportChanged: true }))).toBe(true);
  });

  it("returns true when syntax tree changed", () => {
    const state1 = createEditorState("hello", { extensions: [markdown()] });
    const state2 = createEditorState("hello world", { extensions: [markdown()] });
    expect(cursorSensitiveShouldUpdate(mockViewUpdate({ state: state2, startState: state1 }))).toBe(true);
  });

  it("returns false when nothing changed", () => {
    expect(cursorSensitiveShouldUpdate(mockViewUpdate())).toBe(false);
  });
});

describe("createCursorSensitiveViewPlugin", () => {
  let view: EditorView | undefined;

  interface CursorSensitivePluginProbe {
    decorations: DecorationSet;
    coveredRanges: readonly { from: number; to: number }[];
    rebuild(view: EditorView): void;
    update(update: ViewUpdate): void;
    incrementalDocUpdate(
      update: ViewUpdate,
      dirtyRanges: readonly { from: number; to: number }[],
    ): void;
  }

  function getPluginProbe(ext: ReturnType<typeof createCursorSensitiveViewPlugin>): CursorSensitivePluginProbe {
    const plugin = view?.plugin(ext as unknown as ViewPlugin<CursorSensitivePluginProbe>);
    expect(plugin).toBeTruthy();
    if (!plugin) throw new Error("expected cursor-sensitive plugin instance");
    return plugin;
  }

  function setVisibleRanges(
    ranges: readonly { from: number; to: number }[],
  ): (next: readonly { from: number; to: number }[]) => void {
    let current = ranges;
    Object.defineProperty(view!, "visibleRanges", {
      configurable: true,
      get: () => current,
    });
    return (next) => {
      current = next;
    };
  }

  function mockViewportUpdate(): ViewUpdate {
    return {
      docChanged: false,
      selectionSet: false,
      focusChanged: false,
      viewportChanged: true,
      state: view!.state,
      startState: view!.state,
      view: view!,
    } as unknown as ViewUpdate;
  }

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("returns a valid Extension", () => {
    const ext = createCursorSensitiveViewPlugin(() => []);
    expect(ext).toBeDefined();
  });

  it("calls collectFn on construction with visibleRanges", () => {
    let receivedRanges: readonly { from: number; to: number }[] = [];
    const ext = createCursorSensitiveViewPlugin((_view, ranges) => {
      receivedRanges = ranges;
      return [];
    });
    view = createTestView("hello world", { extensions: [markdown(), ext] });
    expect(receivedRanges.length).toBeGreaterThan(0);
  });

  it("calls collectFn on doc change (full rebuild)", () => {
    let callCount = 0;
    const ext = createCursorSensitiveViewPlugin(() => {
      callCount++;
      return [];
    });
    view = createTestView("hello", { extensions: [markdown(), ext] });
    callCount = 0;
    view.dispatch({ changes: { from: 0, insert: "x" } });
    expect(callCount).toBe(1);
  });

  it("rebuilds only dirty doc ranges when docChangeRanges opts in", () => {
    let receivedRanges: readonly { from: number; to: number }[] = [];
    const ext = createCursorSensitiveViewPlugin(
      (_view, ranges) => {
        receivedRanges = ranges;
        return [];
      },
      {
        selectionCheck: () => false,
        docChangeRanges: (update) => {
          const dirtyRanges: { from: number; to: number }[] = [];
          update.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
            dirtyRanges.push({ from: fromB, to: toB });
          });
          return dirtyRanges;
        },
      },
    );
    view = createTestView("hello world", { extensions: [markdown(), ext] });
    view.dispatch({ selection: { anchor: 0 } });
    receivedRanges = [];
    view.dispatch({ changes: { from: 6, to: 11, insert: "friend" } });
    expect(receivedRanges).toEqual([{ from: 6, to: 12 }]);
  });

  it("rebuilds only local context ranges when contextChangeRanges opts in", () => {
    let receivedRanges: readonly { from: number; to: number }[] = [];
    const ext = createCursorSensitiveViewPlugin(
      (_view, ranges) => {
        receivedRanges = ranges;
        return [];
      },
      {
        contextChangeRanges: (update) =>
          update.selectionSet ? [{ from: 4, to: 7 }] : [],
      },
    );
    view = createTestView("hello world", { extensions: [markdown(), ext] });
    view.dispatch({ selection: { anchor: 0 } });
    receivedRanges = [];

    view.dispatch({ selection: { anchor: 5 } });

    expect(receivedRanges).toEqual([{ from: 4, to: 7 }]);
  });

  it("combines local context ranges with newly visible fragments", () => {
    let receivedRanges: readonly { from: number; to: number }[] = [];
    const ext = createCursorSensitiveViewPlugin(
      (_view, ranges) => {
        receivedRanges = ranges;
        return [];
      },
      {
        contextChangeRanges: () => [{ from: 60, to: 70 }],
      },
    );
    view = createTestView("x".repeat(300), { extensions: [markdown(), ext] });
    const plugin = getPluginProbe(ext);
    const setRanges = setVisibleRanges([{ from: 0, to: 100 }]);
    plugin.rebuild(view);
    receivedRanges = [];

    setRanges([{ from: 50, to: 150 }]);
    plugin.update({
      docChanged: false,
      selectionSet: true,
      focusChanged: false,
      viewportChanged: true,
      state: view.state,
      startState: view.state,
      view,
    } as unknown as ViewUpdate);

    expect(receivedRanges).toEqual([
      { from: 60, to: 70 },
      { from: 100, to: 150 },
    ]);
  });

  it("evicts offscreen decorations and avoids duplicates when scrolling back", () => {
    const trackedNodes = [
      { from: 10, to: 20 },
      { from: 80, to: 120 },
      { from: 150, to: 170 },
    ];
    const ext = createCursorSensitiveViewPlugin((_view, ranges, skip) => {
      const items = [];
      for (const node of trackedNodes) {
        if (!ranges.some((range) => node.from < range.to && node.to > range.from)) continue;
        if (skip(node.from)) continue;
        items.push(Decoration.mark({ class: `node-${node.from}` }).range(node.from, node.to));
      }
      return items;
    });
    view = createTestView("x".repeat(300), { extensions: [markdown(), ext] });
    const plugin = getPluginProbe(ext);
    const setRanges = setVisibleRanges([{ from: 0, to: 100 }]);
    plugin.rebuild(view);

    const specKeys = () => getDecorationSpecs(plugin.decorations)
      .map((spec) => `${spec.class}:${spec.from}-${spec.to}`)
      .sort();

    expect(specKeys()).toEqual([
      "node-10:10-20",
      "node-80:80-120",
    ]);
    expect(plugin.coveredRanges).toEqual([{ from: 0, to: 100 }]);

    setRanges([{ from: 90, to: 190 }]);
    plugin.update(mockViewportUpdate());
    expect(specKeys()).toEqual([
      "node-150:150-170",
      "node-80:80-120",
    ]);
    expect(plugin.coveredRanges).toEqual([{ from: 90, to: 190 }]);

    setRanges([{ from: 0, to: 100 }]);
    plugin.update(mockViewportUpdate());
    expect(specKeys()).toEqual([
      "node-10:10-20",
      "node-80:80-120",
    ]);
    expect(getDecorationSpecs(plugin.decorations).filter((spec) => spec.from === 80)).toHaveLength(1);
    expect(plugin.coveredRanges).toEqual([{ from: 0, to: 100 }]);
  });

  it("skips pure viewport updates when onViewportOnly=skip", () => {
    let callCount = 0;
    const ext = createCursorSensitiveViewPlugin(
      () => {
        callCount++;
        return [];
      },
      {
        onViewportOnly: "skip",
      },
    );
    view = createTestView("x".repeat(300), { extensions: [markdown(), ext] });
    const plugin = getPluginProbe(ext);
    const setRanges = setVisibleRanges([{ from: 0, to: 100 }]);
    plugin.rebuild(view);
    const beforeDecorations = plugin.decorations;
    const beforeCoveredRanges = plugin.coveredRanges;
    callCount = 0;

    setRanges([{ from: 90, to: 190 }]);
    plugin.update(mockViewportUpdate());

    expect(callCount).toBe(0);
    expect(plugin.decorations).toBe(beforeDecorations);
    expect(plugin.coveredRanges).toEqual(beforeCoveredRanges);
  });

  it("still applies real context dirty ranges when onViewportOnly=skip", () => {
    let receivedRanges: readonly { from: number; to: number }[] = [];
    const ext = createCursorSensitiveViewPlugin(
      (_view, ranges) => {
        receivedRanges = ranges;
        return [];
      },
      {
        onViewportOnly: "skip",
        contextChangeRanges: () => [{ from: 60, to: 70 }],
      },
    );
    view = createTestView("x".repeat(300), { extensions: [markdown(), ext] });
    const plugin = getPluginProbe(ext);
    const setRanges = setVisibleRanges([{ from: 0, to: 100 }]);
    plugin.rebuild(view);
    receivedRanges = [];

    setRanges([{ from: 50, to: 150 }]);
    plugin.update({
      docChanged: false,
      selectionSet: true,
      focusChanged: false,
      viewportChanged: true,
      state: view.state,
      startState: view.state,
      view,
    } as unknown as ViewUpdate);

    expect(receivedRanges).toEqual([
      { from: 60, to: 70 },
      { from: 100, to: 150 },
    ]);
  });

  it("recovers skipped viewport changes on the next incremental doc update", () => {
    const trackedNodes = [
      { from: 10, to: 20 },
      { from: 80, to: 120 },
      { from: 150, to: 170 },
    ];
    const ext = createCursorSensitiveViewPlugin(
      (_view, ranges, skip) => {
        const items = [];
        for (const node of trackedNodes) {
          if (!ranges.some((range) => node.from < range.to && node.to > range.from)) continue;
          if (skip(node.from)) continue;
          items.push(Decoration.mark({ class: `node-${node.from}` }).range(node.from, node.to));
        }
        return items;
      },
      {
        onViewportOnly: "skip",
        selectionCheck: () => false,
        docChangeRanges: (update) => {
          const dirtyRanges: { from: number; to: number }[] = [];
          update.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
            dirtyRanges.push({ from: fromB, to: toB });
          });
          return dirtyRanges;
        },
      },
    );
    view = createTestView("x".repeat(300), { extensions: [markdown(), ext] });
    const plugin = getPluginProbe(ext);
    const setRanges = setVisibleRanges([{ from: 0, to: 100 }]);
    plugin.rebuild(view);

    const specKeys = () => getDecorationSpecs(plugin.decorations)
      .map((spec) => `${spec.class}:${spec.from}-${spec.to}`)
      .sort();

    expect(specKeys()).toEqual([
      "node-10:10-20",
      "node-80:80-120",
    ]);

    setRanges([{ from: 90, to: 190 }]);
    plugin.update(mockViewportUpdate());
    expect(specKeys()).toEqual([
      "node-10:10-20",
      "node-80:80-120",
    ]);

    view.dispatch({
      changes: { from: 95, to: 96, insert: "!" },
    });

    expect(specKeys()).toEqual([
      "node-150:150-170",
      "node-80:80-120",
    ]);
    expect(plugin.coveredRanges).toEqual([{ from: 90, to: 190 }]);
  });

  it("filters only the dirty visible fragment on incremental doc updates", () => {
    const ext = createCursorSensitiveViewPlugin(() => []);
    view = createTestView("x".repeat(300), { extensions: [markdown(), ext] });
    const plugin = getPluginProbe(ext);
    setVisibleRanges([{ from: 0, to: 120 }]);
    plugin.rebuild(view);

    const updateSpy = vi.spyOn(Object.getPrototypeOf(plugin.decorations), "update");
    const tr = view.state.update({ changes: { from: 25, insert: "!" } });

    try {
      plugin.incrementalDocUpdate({
        changes: tr.changes,
        docChanged: true,
        selectionSet: false,
        focusChanged: false,
        viewportChanged: false,
        state: tr.state,
        startState: view.state,
        view,
      } as unknown as ViewUpdate, [{ from: 25, to: 26 }]);

      const filterCalls = updateSpy.mock.calls
        .map(([spec]) => spec as { filterFrom?: number; filterTo?: number; filter?: unknown })
        .filter((spec) => spec.filter !== undefined);

      expect(filterCalls.some((spec) => spec.filterFrom === 25 && spec.filterTo === 26)).toBe(true);
      expect(
        filterCalls.some((spec) => spec.filterFrom === 0 && spec.filterTo === tr.state.doc.length),
      ).toBe(false);
    } finally {
      updateSpy.mockRestore();
    }
  });

  it("falls back to a full rebuild when docChangeRanges returns null", () => {
    let receivedRanges: readonly { from: number; to: number }[] = [];
    const ext = createCursorSensitiveViewPlugin(
      (_view, ranges) => {
        receivedRanges = ranges;
        return [];
      },
      {
        selectionCheck: () => false,
        docChangeRanges: () => null,
      },
    );
    view = createTestView("hello world", { extensions: [markdown(), ext] });
    view.dispatch({ selection: { anchor: 0 } });
    receivedRanges = [];
    view.dispatch({ changes: { from: 6, to: 11, insert: "friend" } });
    expect(receivedRanges).toEqual([{ from: 0, to: view.state.doc.length }]);
  });

  it("calls collectFn on selection change (full rebuild)", () => {
    let callCount = 0;
    const ext = createCursorSensitiveViewPlugin(() => {
      callCount++;
      return [];
    });
    view = createTestView("hello world", { extensions: [markdown(), ext] });
    callCount = 0;
    view.dispatch({ selection: { anchor: 5 } });
    expect(callCount).toBe(1);
  });

  it("triggers full rebuild when extraRebuildCheck fires", () => {
    let callCount = 0;
    const ext = createCursorSensitiveViewPlugin(
      () => {
        callCount++;
        return [];
      },
      { extraRebuildCheck: () => true },
    );
    view = createTestView("hello", { extensions: [markdown(), ext] });
    callCount = 0;
    view.dispatch({});
    expect(callCount).toBe(1);
  });

  it("triggers full rebuild on programmatic document rewrites", () => {
    let callCount = 0;
    const ext = createCursorSensitiveViewPlugin(
      () => {
        callCount++;
        return [];
      },
      {
        selectionCheck: () => false,
        docChangeRanges: () => [],
      },
    );
    view = createTestView("hello", { extensions: [markdown(), ext] });
    callCount = 0;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "world" },
      annotations: programmaticDocumentChangeAnnotation.of(true),
    });
    expect(callCount).toBe(1);
  });

  it("passes skip=NO_SKIP on full rebuild", () => {
    let skipResult: boolean | undefined;
    const ext = createCursorSensitiveViewPlugin((_view, _ranges, skip) => {
      skipResult = skip(42);
      return [];
    });
    view = createTestView("hello", { extensions: [markdown(), ext] });
    expect(skipResult).toBe(false);
  });
});
