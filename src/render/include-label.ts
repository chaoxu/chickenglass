/**
 * Right-margin filename decoration for include blocks.
 * Single ViewPlugin computes both line decorations and widget labels in one pass.
 *
 * Prefers include regions tracked in always-on editor state for expanded
 * documents, and falls back to raw include-block semantics when the
 * document has not been expanded.
 */

import {
  Decoration,
  type DecorationSet,
  EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { type Extension, type Range } from "@codemirror/state";
import { buildDecorations } from "./decoration-core";
import { createSimpleViewPlugin } from "./view-plugin-factories";
import { SimpleTextRenderWidget } from "./source-widget";
import { containsPos } from "../lib/range-helpers";
import { basename } from "../lib/utils";
import { includeRegionsField, type IncludeRegionState } from "../lib/include-regions";
import {
  documentAnalysisField,
  getDocumentAnalysisSliceRevision,
} from "../semantics/codemirror-source";

interface IncludeLabelRegion {
  readonly from: number;
  readonly to: number;
  readonly path: string;
}

function getIncludeLabelRegions(view: EditorView): readonly IncludeLabelRegion[] {
  const regions = view.state.field(includeRegionsField, false) ?? [];
  if (regions.length > 0) {
    return mapIncludeRegions(regions);
  }

  return view.state.field(documentAnalysisField, false)?.includes ?? [];
}

function mapIncludeRegions(
  regions: readonly IncludeRegionState[],
): readonly IncludeLabelRegion[] {
  if (regions.length > 0) {
    return regions.map((region: IncludeRegionState) => ({
      from: region.from,
      to: region.to,
      path: region.file,
    }));
  }
  return [];
}

/** Build include label decorations (line highlights + filename labels). */
function buildIncludeDecorations(view: EditorView): DecorationSet {
  const includes = getIncludeLabelRegions(view);
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
    const active = containsPos({ from, to }, cursor);
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
  includes: readonly IncludeLabelRegion[],
  cursor: number,
): IncludeLabelRegion | undefined {
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
  const beforeRegions = update.startState.field(includeRegionsField, false) ?? [];
  const afterRegions = update.state.field(includeRegionsField, false) ?? [];
  if (beforeRegions !== afterRegions) {
    return true;
  }

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

  const beforeActiveSource = beforeRegions.length > 0
    ? mapIncludeRegions(beforeRegions)
    : before.includes;
  const afterActiveSource = afterRegions.length > 0
    ? mapIncludeRegions(afterRegions)
    : after.includes;

  const beforeActive = findActiveInclude(
    beforeActiveSource,
    update.startState.selection.main.head,
  );
  const afterActive = findActiveInclude(
    afterActiveSource,
    update.state.selection.main.head,
  );

  return beforeActive?.from !== afterActive?.from
    || beforeActive?.to !== afterActive?.to;
}

const includeLabelViewPlugin = createSimpleViewPlugin(
  buildIncludeDecorations,
  { shouldUpdate: includeShouldUpdate },
);

export { includeLabelViewPlugin as _includeLabelViewPluginForTest };

/** CM6 extension that renders include region labels in the right margin. */
export const includeLabelPlugin: Extension = includeLabelViewPlugin;
