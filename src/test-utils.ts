import { expect, vi } from "vitest";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, type Extension, type StateEffect } from "@codemirror/state";
import { EditorView, type DecorationSet } from "@codemirror/view";
import type { Parser, Tree } from "@lezer/common";
import type { BlockPlugin } from "./plugins/plugin-types";
import type { CslJsonItem } from "./citations/bibtex-parser";
import type { BibStore } from "./state/bib-data";

// ── CslJsonItem fixture factory ───────────────────────────────────────────────

/**
 * Create a minimal CslJsonItem suitable for tests.
 * Callers supply only the fields relevant to their test; all optional fields
 * default to sensible values so tests stay concise.
 */
export function createCslFixture(overrides: Partial<CslJsonItem> & { id: string }): CslJsonItem {
  return {
    type: "article-journal",
    author: [{ family: "Author", given: "A." }],
    title: "A Test Paper",
    issued: { "date-parts": [[2020]] },
    ...overrides,
  };
}

/**
 * A small, ready-to-use set of CslJsonItem fixtures for tests that need
 * a populated bibliography store without caring about specific entries.
 */
export const CSL_FIXTURES = {
  karger: createCslFixture({
    id: "karger2000",
    type: "article-journal",
    author: [{ family: "Karger", given: "David R." }],
    title: "Minimum cuts in near-linear time",
    issued: { "date-parts": [[2000]] },
    "container-title": "JACM",
    volume: "47",
    issue: "1",
    page: "46-76",
  }),
  stein: createCslFixture({
    id: "stein2001",
    type: "book",
    author: [{ family: "Stein", given: "Clifford" }],
    title: "Algorithms",
    issued: { "date-parts": [[2001]] },
    publisher: "MIT Press",
  }),
} as const;

// ── localStorage mock helper ──────────────────────────────────────────────────

/**
 * Install a spec-compliant in-memory localStorage shim on `globalThis`.
 *
 * Returns a handle with a `clear()` method that empties the backing store.
 * Intended for use in `beforeEach` + `afterEach` pairs in tests that interact
 * with localStorage without a real browser:
 *
 * ```ts
 * const ls = installLocalStorageMock();
 * beforeEach(() => ls.clear());
 * ```
 *
 * Node 25+ exposes a native `localStorage` that lacks standard methods when
 * `--localstorage-file` is not set. This shim replaces it unconditionally.
 */
export function installLocalStorageMock(): { clear: () => void } {
  const storage = new Map<string, string>();
  const shim: Storage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, String(value)); },
    removeItem: (key: string) => { storage.delete(key); },
    clear: () => { storage.clear(); },
    get length() { return storage.size; },
    key: (index: number) => [...storage.keys()][index] ?? null,
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: shim,
    writable: true,
    configurable: true,
  });
  return { clear: () => storage.clear() };
}

export interface NodeInfo {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

export function parseNodeNames(text: string, parser: Parser): string[] {
  const tree = parser.parse(text);
  const names: string[] = [];
  tree.iterate({
    enter(node) {
      names.push(node.name);
    },
  });
  return names;
}

export function parseNodeInfos(text: string, parser: Parser): NodeInfo[] {
  const tree = parser.parse(text);
  const infos: NodeInfo[] = [];
  tree.iterate({
    enter(node) {
      infos.push({
        name: node.name,
        from: node.from,
        to: node.to,
        text: text.slice(node.from, node.to),
      });
    },
  });
  return infos;
}

export function findNodeInfo(infos: readonly NodeInfo[], name: string): NodeInfo {
  const node = infos.find((candidate) => candidate.name === name);
  expect(node, `expected to find node "${name}"`).toBeDefined();
  if (!node) throw new Error(`unreachable: node "${name}" not found`);
  return node;
}

export function createEditorState(
  doc: string,
  options: {
    cursorPos?: number;
    extensions?: Extension;
  } = {},
): EditorState {
  const { cursorPos = 0, extensions = [] } = options;
  return EditorState.create({
    doc,
    selection: { anchor: cursorPos },
    extensions,
  });
}

export function ensureFullSyntaxTree(
  state: EditorState,
  timeout = 5000,
): Tree {
  const tree = ensureSyntaxTree(state, state.doc.length, timeout);
  if (!tree) {
    throw new Error(
      `failed to fully parse test document (${state.doc.length} characters)`,
    );
  }
  return tree;
}

export function applyStateEffects(
  state: EditorState,
  effects: StateEffect<unknown> | readonly StateEffect<unknown>[],
): EditorState {
  return state.update({
    effects: Array.isArray(effects) ? effects : [effects],
  }).state;
}

const activeTestViews = new Set<EditorView>();

export function destroyAllTestViews(): void {
  for (const view of [...activeTestViews]) {
    view.destroy();
  }
  activeTestViews.clear();
}

export function createTestView(
  doc: string,
  options: {
    cursorPos?: number;
    extensions?: Extension;
    focus?: boolean;
  } = {},
): EditorView {
  const { cursorPos, extensions = [], focus = true } = options;
  const state = EditorState.create({
    doc,
    selection: cursorPos !== undefined ? { anchor: cursorPos } : undefined,
    extensions,
  });
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({ state, parent });
  if (focus) {
    view.focus();
  }
  const originalDestroy = view.destroy.bind(view);
  let destroyed = false;
  activeTestViews.add(view);
  view.destroy = () => {
    if (destroyed) {
      return;
    }
    destroyed = true;
    activeTestViews.delete(view);
    originalDestroy();
    parent.remove();
  };
  return view;
}

export interface DecorationSpecInfo {
  readonly from: number;
  readonly to: number;
  readonly class?: string;
  readonly widgetClass?: string;
  readonly block?: boolean;
}

export function getDecorationSpecs(decoSet: DecorationSet): DecorationSpecInfo[] {
  const specs: DecorationSpecInfo[] = [];
  const cursor = decoSet.iter();
  while (cursor.value) {
    const spec = cursor.value.spec;
    specs.push({
      from: cursor.from,
      to: cursor.to,
      class: spec.class as string | undefined,
      widgetClass: spec.widget?.constructor?.name,
      block: spec.block as boolean | undefined,
    });
    cursor.next();
  }
  return specs;
}

export function hasLineClassAt(
  specs: readonly DecorationSpecInfo[],
  lineStart: number,
  classSubstr: string,
): boolean {
  return specs.some(
    (spec) => spec.from === lineStart && spec.from === spec.to && spec.class?.includes(classSubstr),
  );
}

/** Check whether a mark decoration with the given class covers at least part of [from, to). */
export function hasMarkClassInRange(
  specs: readonly DecorationSpecInfo[],
  from: number,
  to: number,
  classSubstr: string,
): boolean {
  return specs.some(
    (spec) =>
      spec.from !== spec.to && // mark decoration (not line)
      spec.from < to &&
      spec.to > from &&
      spec.class?.includes(classSubstr),
  );
}

// ── Mock EditorView helper ────────────────────────────────────────────────────

/**
 * Options for {@link createMockEditorView}. All fields are optional so callers
 * only supply the slice relevant to their test.
 */
export interface MockEditorViewOptions {
  /** Whether `view.dom.isConnected` returns true (default: true). */
  isConnected?: boolean;
  /** Override for `view.dispatch`. Defaults to `vi.fn()`. */
  dispatch?: (...args: unknown[]) => void;
  /** Provide extra `state` properties merged onto a minimal default. */
  state?: Record<string, unknown>;
  /** Override for `view.focus`. Defaults to `vi.fn()`. */
  focus?: () => void;
  /** Override for `view.requestMeasure`. Defaults to `vi.fn()`. */
  requestMeasure?: () => void;
  /** Override for `view.destroy`. Defaults to `vi.fn()`. */
  destroy?: () => void;
  /** Override for `view.posAtCoords`. Defaults to returning `null`. */
  posAtCoords?: () => number | null;
  /** Override for `view.contentDOM`. Defaults to a detached `<div>`. */
  contentDOM?: HTMLElement;
}

/**
 * Build a minimal `EditorView` mock suitable for unit tests that don't need a
 * live DOM or CM6 state machinery.
 *
 * Centralises the single `as unknown as EditorView` escape hatch so individual
 * test files stay free of double-casts and the mock shape is easy to evolve.
 */
export function createMockEditorView(options: MockEditorViewOptions = {}): EditorView {
  const {
    isConnected = true,
    dispatch,
    state = {},
    focus,
    requestMeasure,
    destroy,
    posAtCoords,
    contentDOM,
  } = options;

  const mock = {
    dom: { isConnected } as HTMLElement,
    dispatch: dispatch ?? vi.fn(),
    focus: focus ?? vi.fn(),
    requestMeasure: requestMeasure ?? vi.fn(),
    destroy: destroy ?? vi.fn(),
    posAtCoords: posAtCoords ?? (() => null),
    contentDOM: contentDOM ?? document.createElement("div"),
    state: {
      sliceDoc: () => "",
      doc: { toString: () => "", length: 0 },
      selection: { main: { head: 0, from: 0, to: 0 } },
      ...state,
    },
  };

  return mock as unknown as EditorView;
}

export function makeBlockPlugin(
  overrides: Partial<BlockPlugin> & { name: string },
): BlockPlugin {
  return {
    numbered: true,
    title: overrides.name.charAt(0).toUpperCase() + overrides.name.slice(1),
    render: (attrs) => ({
      className: `cf-block cf-block-${attrs.type}`,
      header: `${overrides.title ?? overrides.name} ${attrs.number ?? ""}`.trim(),
    }),
    ...overrides,
  };
}

export function makeBibStore(items: CslJsonItem[]): BibStore {
  return new Map(items.map((item) => [item.id, item]));
}
