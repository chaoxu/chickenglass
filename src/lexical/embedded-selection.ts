import { readVisibleTextDomSelection } from "./dom-selection";
import { createMarkdownSelection } from "./editor-surface-shared";
import { parseStructuredFencedDivRaw } from "./markdown/block-syntax";
import type { MarkdownEditorSelection } from "./markdown-editor-types";
import { readSourceFrom, readSourceTo } from "./source-position-contract";
import { mapVisibleTextSelectionToMarkdown } from "./source-selection";
import { fencedDivTitleMarkdownOffset } from "./structure-source-offsets";

export function readEmbeddedInlineDomSelection(doc: string): MarkdownEditorSelection | null {
  const selection = document.getSelection();
  const { anchorNode, focusNode } = selection ?? {};
  if (!selection || !anchorNode || !focusNode) {
    return null;
  }
  const anchorElement = anchorNode instanceof HTMLElement ? anchorNode : anchorNode.parentElement;
  const titleShell = anchorElement?.closest<HTMLElement>(".cf-lexical-block-title");
  const root = titleShell?.querySelector<HTMLElement>("[contenteditable='true']");
  const rawBlock = titleShell?.closest<HTMLElement>("[data-coflat-raw-block='true']");
  if (!root || !rawBlock || !root.contains(anchorNode) || !root.contains(focusNode)) {
    return null;
  }
  const selectedText = selection.toString();
  if (selectedText) {
    const boldNeedle = `**${selectedText}**`;
    const boldFrom = doc.indexOf(boldNeedle);
    if (boldFrom >= 0 && doc.indexOf(boldNeedle, boldFrom + boldNeedle.length) < 0) {
      return createMarkdownSelection(
        boldFrom + 2,
        boldFrom + 2 + selectedText.length,
        doc.length,
      );
    }
  }
  const sourceFrom = readSourceFrom(rawBlock);
  const sourceTo = readSourceTo(rawBlock);
  const visibleSelection = readVisibleTextDomSelection(root);
  if (sourceFrom === null || sourceTo === null || !visibleSelection) {
    return null;
  }
  const raw = doc.slice(sourceFrom, sourceTo);
  const parsed = parseStructuredFencedDivRaw(raw);
  const titleOffset = fencedDivTitleMarkdownOffset(raw, parsed);
  if (titleOffset === null || !parsed.titleMarkdown) {
    return null;
  }
  const mapped = mapVisibleTextSelectionToMarkdown(parsed.titleMarkdown, {
    anchor: visibleSelection.anchor,
    focus: visibleSelection.focus,
    from: visibleSelection.from,
    to: visibleSelection.to,
  });
  if (!mapped) {
    return null;
  }
  return createMarkdownSelection(
    sourceFrom + titleOffset + mapped.anchor,
    sourceFrom + titleOffset + mapped.focus,
    doc.length,
  );
}

