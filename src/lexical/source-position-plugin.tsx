import { useEffect, useMemo } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createNodeSelection,
  $getNearestNodeFromDOMNode,
  $setSelection,
  scrollIntoViewIfNeeded,
  type LexicalEditor,
} from "lexical";

import {
  NAVIGATE_SOURCE_POSITION_EVENT,
  type NavigateSourcePositionEventDetail,
} from "../constants/events";
import { $isRawBlockNode } from "./nodes/raw-block-node";

const FRONTMATTER_DELIMITER = /^---\s*$/;
const FENCED_DIV_START = /^\s*(:{3,})(.*)$/;
const DISPLAY_MATH_DOLLAR_START = /^\s*\$\$(?!\$).*$/;
const DISPLAY_MATH_BRACKET_START = /^\s*\\\[\s*$/;
const DISPLAY_MATH_DOLLAR_END = /^\s*\$\$(?:\s+\{#[^}]+\})?\s*$/;
const DISPLAY_MATH_BRACKET_END = /^\s*\\\](?:\s+\{#[^}]+\})?\s*$/;
const IMAGE_BLOCK_START = /^\s*!\[[^\]\n]*\]\([^)]+\)\s*$/;
const FOOTNOTE_DEFINITION_START = /^\[\^[^\]]+\]:\s*(.*)$/;
const SOURCE_BLOCK_SELECTOR = "[data-coflat-raw-block='true'], [data-coflat-table-block='true']";

function computeLineOffsets(lines: readonly string[]): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  return offsets;
}

function matchDisplayMathEnd(
  lines: readonly string[],
  startLineIndex: number,
  endRegExp: RegExp,
): number {
  const startLine = lines[startLineIndex] ?? "";
  if (DISPLAY_MATH_DOLLAR_START.test(startLine)) {
    const sameLineEnd = startLine.indexOf("$$", startLine.indexOf("$$") + 2);
    if (sameLineEnd !== -1) {
      return startLineIndex;
    }
  }

  for (let lineIndex = startLineIndex + 1; lineIndex < lines.length; lineIndex += 1) {
    if (endRegExp.test(lines[lineIndex] ?? "")) {
      return lineIndex;
    }
  }

  return -1;
}

function collectSourceBlockStarts(doc: string): number[] {
  const lines = doc.split("\n");
  const offsets = computeLineOffsets(lines);
  const starts: number[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";

    if (lineIndex === 0 && FRONTMATTER_DELIMITER.test(line)) {
      starts.push(offsets[lineIndex] ?? 0);
      for (let endLine = 1; endLine < lines.length; endLine += 1) {
        if (FRONTMATTER_DELIMITER.test(lines[endLine] ?? "")) {
          lineIndex = endLine;
          break;
        }
      }
      continue;
    }

    const fencedMatch = line.match(FENCED_DIV_START);
    if (fencedMatch) {
      const colonCount = fencedMatch[1]?.length ?? 0;
      const closingFence = new RegExp(`^\\s*:{${colonCount}}\\s*$`);
      starts.push(offsets[lineIndex] ?? 0);
      for (let endLine = lineIndex + 1; endLine < lines.length; endLine += 1) {
        if (closingFence.test(lines[endLine] ?? "")) {
          lineIndex = endLine;
          break;
        }
      }
      continue;
    }

    if (DISPLAY_MATH_DOLLAR_START.test(line)) {
      const endLine = matchDisplayMathEnd(lines, lineIndex, DISPLAY_MATH_DOLLAR_END);
      if (endLine >= 0) {
        starts.push(offsets[lineIndex] ?? 0);
        lineIndex = endLine;
        continue;
      }
    }

    if (DISPLAY_MATH_BRACKET_START.test(line)) {
      const endLine = matchDisplayMathEnd(lines, lineIndex, DISPLAY_MATH_BRACKET_END);
      if (endLine >= 0) {
        starts.push(offsets[lineIndex] ?? 0);
        lineIndex = endLine;
        continue;
      }
    }

    if (IMAGE_BLOCK_START.test(line)) {
      starts.push(offsets[lineIndex] ?? 0);
      continue;
    }

    if (FOOTNOTE_DEFINITION_START.test(line)) {
      starts.push(offsets[lineIndex] ?? 0);
      for (let endLine = lineIndex + 1; endLine < lines.length; endLine += 1) {
        const nextLine = lines[endLine] ?? "";
        if (/^\s*$/.test(nextLine) || !/^\s{2,4}\S/.test(nextLine)) {
          lineIndex = endLine - 1;
          break;
        }
        if (endLine === lines.length - 1) {
          lineIndex = endLine;
        }
      }
      continue;
    }

    const dividerLine = lines[lineIndex + 1] ?? "";
    if (/\|/.test(line) && /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(dividerLine)) {
      starts.push(offsets[lineIndex] ?? 0);
      lineIndex += 1;
      for (let endLine = lineIndex + 1; endLine < lines.length; endLine += 1) {
        const nextLine = lines[endLine] ?? "";
        if (!/\|/.test(nextLine) || /^\s*$/.test(nextLine)) {
          lineIndex = endLine - 1;
          break;
        }
        if (endLine === lines.length - 1) {
          lineIndex = endLine;
        }
      }
    }
  }

  return starts;
}

export function syncSourceBlockPositions(root: HTMLElement | null, doc: string): void {
  if (!root) {
    return;
  }

  const starts = collectSourceBlockStarts(doc);
  const elements = [...root.querySelectorAll<HTMLElement>(SOURCE_BLOCK_SELECTOR)];

  elements.forEach((element, index) => {
    const start = starts[index];
    if (start === undefined) {
      delete element.dataset.coflatSourceFrom;
      return;
    }
    element.dataset.coflatSourceFrom = String(start);
  });
}

function selectNavigationTarget(
  editor: LexicalEditor,
  root: HTMLElement,
  target: HTMLElement,
): boolean {
  let didSelect = false;

  editor.update(() => {
    const node = $getNearestNodeFromDOMNode(target);
    if (!node) {
      return;
    }

    if ($isRawBlockNode(node)) {
      const selection = $createNodeSelection();
      selection.add(node.getKey());
      $setSelection(selection);
      didSelect = true;
      return;
    }

    node.selectStart();
    didSelect = true;
  }, { discrete: true });

  if (didSelect) {
    editor.focus(() => {
      scrollIntoViewIfNeeded(editor, target.getBoundingClientRect(), root);
    });
  }

  return didSelect;
}

export function scrollSourcePositionIntoView(
  editor: LexicalEditor,
  root: HTMLElement | null,
  pos: number,
): boolean {
  if (!root) {
    return false;
  }

  const heading = root.querySelector<HTMLElement>(`.cf-lexical-heading[data-coflat-heading-pos="${String(pos)}"]`);
  if (heading) {
    return selectNavigationTarget(editor, root, heading);
  }

  const rawBlocks = [...root.querySelectorAll<HTMLElement>("[data-coflat-source-from]")];
  if (rawBlocks.length === 0) {
    return false;
  }

  let target = rawBlocks[0] ?? null;
  let bestStart = Number.NEGATIVE_INFINITY;
  for (const block of rawBlocks) {
    const start = Number(block.dataset.coflatSourceFrom ?? "");
    if (!Number.isFinite(start)) {
      continue;
    }
    if (start <= pos && start >= bestStart) {
      bestStart = start;
      target = block;
    }
  }

  if (!target) {
    return false;
  }

  return selectNavigationTarget(editor, root, target);
}

export function SourcePositionPlugin({
  doc,
  enableNavigation = false,
}: {
  readonly doc: string;
  readonly enableNavigation?: boolean;
}) {
  const [editor] = useLexicalComposerContext();
  const syncToken = useMemo(() => ({ doc }), [doc]);

  useEffect(() => {
    const sync = () => {
      syncSourceBlockPositions(editor.getRootElement(), syncToken.doc);
    };

    sync();
    return editor.registerUpdateListener(() => {
      sync();
    });
  }, [editor, syncToken]);

  useEffect(() => {
    if (!enableNavigation) {
      return;
    }

    const handleNavigation = (event: Event) => {
      const detail = (event as CustomEvent<NavigateSourcePositionEventDetail>).detail;
      scrollSourcePositionIntoView(editor, editor.getRootElement(), detail.pos);
    };

    document.addEventListener(NAVIGATE_SOURCE_POSITION_EVENT, handleNavigation);
    return () => {
      document.removeEventListener(NAVIGATE_SOURCE_POSITION_EVENT, handleNavigation);
    };
  }, [editor, enableNavigation]);

  return null;
}
