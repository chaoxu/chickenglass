import { expect } from "vitest";
import { EditorState, type Extension, type StateEffect } from "@codemirror/state";
import { EditorView, type DecorationSet } from "@codemirror/view";
import type { Parser } from "@lezer/common";
import type { BlockPlugin } from "./plugins/plugin-types";
import type { CslJsonItem } from "./citations/bibtex-parser";
import type { BibStore } from "./citations/citation-render";

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

export function applyStateEffects(
  state: EditorState,
  effects: StateEffect<unknown> | readonly StateEffect<unknown>[],
): EditorState {
  return state.update({
    effects: Array.isArray(effects) ? effects : [effects],
  }).state;
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
  view.destroy = () => {
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
