import { type EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { EXCLUDED_FROM_FALLBACK } from "../constants/block-manifest";
import { collectCodeBlocks } from "../render/code-block-render";
import { collectFencedDivs } from "../plugins/fence-protection";
import { getPluginOrFallback, pluginRegistryField } from "../plugins/plugin-registry";

interface ClipboardRange {
  readonly from: number;
  readonly to: number;
}

interface HiddenFenceBlock {
  readonly openTokenFrom: number;
  readonly openStructuralTo: number;
  readonly closeFenceFrom: number;
  readonly closeText: string;
  readonly multiLine: boolean;
}

function getCopiedRanges(state: EditorState): ClipboardRange[] {
  const ranges = state.selection.ranges
    .filter((range) => !range.empty)
    .map(({ from, to }) => ({ from, to }));
  if (ranges.length > 0) return ranges;

  const linewise: ClipboardRange[] = [];
  let upto = -1;
  for (const { from } of state.selection.ranges) {
    const line = state.doc.lineAt(from);
    if (line.number <= upto) continue;
    linewise.push({
      from: line.from,
      to: Math.min(state.doc.length, line.to + 1),
    });
    upto = line.number;
  }
  return linewise;
}

function serializeLiteralCopiedText(
  state: EditorState,
  ranges: readonly ClipboardRange[],
): string {
  return ranges.map(({ from, to }) => state.sliceDoc(from, to)).join(state.lineBreak);
}

function getSingleLineHiddenCloseText(
  state: EditorState,
  closeFenceFrom: number,
  closeFenceTo: number,
): string {
  if (closeFenceFrom < 0 || closeFenceTo <= closeFenceFrom) return "";

  const line = state.doc.lineAt(closeFenceFrom);
  let from = closeFenceFrom;
  while (from > line.from) {
    const ch = line.text.charCodeAt(from - line.from - 1);
    if (ch !== 32 && ch !== 9) break;
    from--;
  }
  return state.sliceDoc(from, closeFenceTo);
}

function getCodeFenceStart(state: EditorState, lineFrom: number, lineTo: number): number {
  const lineText = state.sliceDoc(lineFrom, lineTo);
  const match = /^\s*(`{3,}|~{3,})/.exec(lineText);
  if (!match) return lineFrom;
  return lineFrom + match[0].length - match[1].length;
}

function collectHiddenFenceBlocks(state: EditorState): HiddenFenceBlock[] {
  const blocks: HiddenFenceBlock[] = [];
  const registry = state.field(pluginRegistryField, false);

  for (const div of collectFencedDivs(state)) {
    if (div.closeFenceFrom < 0 || div.closeFenceTo <= div.closeFenceFrom) continue;

    const hasHiddenClose = EXCLUDED_FROM_FALLBACK.has(div.className) ||
      (registry ? Boolean(getPluginOrFallback(registry, div.className)) : false);
    if (!hasHiddenClose) continue;

    const closeText = div.singleLine
      ? getSingleLineHiddenCloseText(state, div.closeFenceFrom, div.closeFenceTo)
      : state.sliceDoc(div.closeFenceFrom, div.closeFenceTo);
    if (!closeText) continue;

    blocks.push({
      openTokenFrom: div.openFenceFrom,
      openStructuralTo: div.titleFrom ?? div.openFenceTo,
      closeFenceFrom: div.closeFenceFrom,
      closeText,
      multiLine: !div.singleLine,
    });
  }

  for (const block of collectCodeBlocks(state)) {
    if (block.singleLine || block.closeFenceFrom < 0 || block.closeFenceTo <= block.closeFenceFrom) {
      continue;
    }

    blocks.push({
      openTokenFrom: getCodeFenceStart(state, block.openFenceFrom, block.openFenceTo),
      openStructuralTo: block.openFenceTo,
      closeFenceFrom: block.closeFenceFrom,
      closeText: state.sliceDoc(block.closeFenceFrom, block.closeFenceTo),
      multiLine: true,
    });
  }

  blocks.sort((a, b) => a.closeFenceFrom - b.closeFenceFrom || a.openTokenFrom - b.openTokenFrom);
  return blocks;
}

function serializeBalancedCopiedText(
  state: EditorState,
  ranges: readonly ClipboardRange[],
  blocks: readonly HiddenFenceBlock[],
): string {
  return ranges.map(({ from, to }) => {
    let text = state.sliceDoc(from, to);
    for (const block of blocks) {
      if (from > block.openTokenFrom) continue;
      if (to < block.openStructuralTo) continue;
      if (to > block.closeFenceFrom) continue;
      if (block.multiLine && !text.endsWith(state.lineBreak)) {
        text += state.lineBreak;
      }
      text += block.closeText;
    }
    return text;
  }).join(state.lineBreak);
}

export function balanceHiddenFenceClipboardText(text: string, state: EditorState): string {
  const ranges = getCopiedRanges(state);
  if (ranges.length === 0) return text;

  const blocks = collectHiddenFenceBlocks(state);
  if (blocks.length === 0) return text;

  const literal = serializeLiteralCopiedText(state, ranges);
  const balanced = serializeBalancedCopiedText(state, ranges, blocks);
  return balanced === literal ? text : balanced;
}

export const richClipboardOutputFilter: Extension = EditorView.clipboardOutputFilter.of(
  balanceHiddenFenceClipboardText,
);
