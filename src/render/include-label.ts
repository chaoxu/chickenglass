/**
 * Right-margin filename decoration for include blocks.
 * Single ViewPlugin computes both line decorations and widget labels in one pass.
 *
 * Reads include block positions and paths from the shared
 * `documentAnalysisField` rather than the global `__cfSourceMap`.
 */

import {
  Decoration,
  type DecorationSet,
  EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { type Extension, type Range } from "@codemirror/state";
import {
  buildDecorations,
  createSimpleViewPlugin,
  SimpleTextRenderWidget,
} from "./render-utils";
import { basename } from "../lib/utils";
import {
  documentAnalysisField,
  getDocumentAnalysisSliceRevision,
} from "../semantics/codemirror-source";
import type { IncludeSemantics } from "../semantics/document";

/** Build include label decorations (line highlights + filename labels). */
function buildIncludeDecorations(view: EditorView): DecorationSet {
  const includes: readonly IncludeSemantics[] =
    view.state.field(documentAnalysisField, false)?.includes ?? [];
  if (includes.length === 0) return Decoration.none;

  const items: Range<Decoration>[] = [];
  const cursor = view.state.selection.main.head;
  const doc = view.state.doc;
  const lineDeco = Decoration.line({ class: "cf-include-region" });

  for (const inc of includes) {
    const from = Math.min(inc.from, doc.length);
    const to = Math.min(inc.to, doc.length);
    if (from >= to) continue;

    // Widget label at start of include block
    const active = cursor >= from && cursor <= to;
    const filename = basename(inc.path);
    const startLine = doc.lineAt(from);
    items.push(Decoration.widget({
      widget: new SimpleTextRenderWidget({
        tagName: "span",
        className: active ? "cf-include-label cf-include-label-active" : "cf-include-label",
        text: filename,
      }),
      side: 1,
    }).range(startLine.from));

    // Line decorations for every line in the include block
    const endLine = doc.lineAt(to);
    for (let ln = startLine.number; ln <= endLine.number; ln++) {
      items.push(lineDeco.range(doc.line(ln).from));
    }
  }
  return buildDecorations(items);
}

function findActiveInclude(
  includes: readonly IncludeSemantics[],
  cursor: number,
): IncludeSemantics | undefined {
  let lo = 0;
  let hi = includes.length - 1;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const include = includes[mid];
    if (cursor < include.from) {
      hi = mid - 1;
      continue;
    }
    if (cursor > include.to) {
      lo = mid + 1;
      continue;
    }
    return include;
  }

  return undefined;
}

/** Custom update predicate: include-slice or active-label changes.
 * Viewport changes alone don't require a rebuild — the tree walk
 * already covers the full document (include blocks may span offscreen). */
function includeShouldUpdate(update: ViewUpdate): boolean {
  const before = update.startState.field(documentAnalysisField);
  const after = update.state.field(documentAnalysisField);
  if (
    after.includes !== before.includes
    || getDocumentAnalysisSliceRevision(after, "includes")
      !== getDocumentAnalysisSliceRevision(before, "includes")
  ) {
    return true;
  }

  if (!update.selectionSet) return false;

  const beforeActive = findActiveInclude(
    before.includes,
    update.startState.selection.main.head,
  );
  const afterActive = findActiveInclude(
    after.includes,
    update.state.selection.main.head,
  );

  return beforeActive?.from !== afterActive?.from
    || beforeActive?.to !== afterActive?.to;
}

/** CM6 extension that renders include region labels in the right margin. */
export const includeLabelPlugin: Extension = createSimpleViewPlugin(
  buildIncludeDecorations,
  { shouldUpdate: includeShouldUpdate },
);
