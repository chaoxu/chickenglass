import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createNodeSelection,
  $getNearestNodeFromDOMNode,
  $getRoot,
  $getSelection,
  $isNodeSelection,
  $isRangeSelection,
  $setSelection,
  type LexicalEditor,
} from "lexical";
import { useEffect, useMemo, useRef } from "react";

import {
  NAVIGATE_SOURCE_POSITION_EVENT,
  type NavigateSourcePositionEventDetail,
} from "../constants/events";
import { measureSync } from "../lib/perf";
import { collectSourceBlockRanges } from "./markdown/block-scanner";
import { $isRawBlockNode } from "./nodes/raw-block-node";
import { $isTableNode } from "./nodes/table-node";
import {
  assignSourceBlockRangesToModelBlocks,
  type SourceBlockModelIdentity,
  type SourceBlockPositionAssignment,
} from "./source-block-position-assignment";
import {
  clearSourceRange,
  HEADING_SOURCE_SELECTOR,
  readSourceFrom,
  readSourceTo,
  SOURCE_BLOCK_SELECTOR,
  SOURCE_POSITION_ATTR,
  setSourceRange,
} from "./source-position-contract";
import { sourcePositionFromElement } from "./source-position-dom";
import { consumeIncrementalSourcePositionSync } from "./source-position-incremental-sync";

export { readSourcePositionFromElement } from "./source-position-dom";
export {
  mapVisibleTextOffsetToMarkdown,
  readSourceSelectionFromLexicalSelection,
  selectSourceOffsetsInRichLexicalNode,
  selectSourceOffsetsInRichLexicalRoot,
} from "./source-selection";

function readSourceBlockNodeKey(element: HTMLElement): string | null {
  return element.getAttribute(SOURCE_POSITION_ATTR.sourceBlockNodeKey);
}

export function syncSourceBlockPositions(
  root: HTMLElement | null,
  doc: string,
  assignments: ReadonlyMap<string, SourceBlockPositionAssignment> = new Map(),
): void {
  if (!root) {
    return;
  }

  const elements = [...root.querySelectorAll<HTMLElement>(SOURCE_BLOCK_SELECTOR)]
    .filter((element) => element.closest(".cf-lexical-root") === root);
  if (elements.length === 0) {
    return;
  }

  measureSync("source.syncSourceBlockPositions", () => {
    const ranges = collectSourceBlockRanges(doc);
    const assignedRanges = new Set<string>();
    const fallbackElements: HTMLElement[] = [];
    for (const element of elements) {
      const nodeKey = readSourceBlockNodeKey(element);
      const assignment = nodeKey ? assignments.get(nodeKey) : undefined;
      if (!assignment) {
        fallbackElements.push(element);
        continue;
      }

      setSourceRange(element, assignment.from, assignment.to);
      assignedRanges.add(`${assignment.from}:${assignment.to}`);
    }

    let rangeCursor = 0;
    fallbackElements.forEach((element) => {
      while (
        rangeCursor < ranges.length
        && assignedRanges.has(`${ranges[rangeCursor]?.from}:${ranges[rangeCursor]?.to}`)
      ) {
        rangeCursor += 1;
      }
      const range = ranges[rangeCursor];
      if (!range) {
        clearSourceRange(element);
        return;
      }
      setSourceRange(element, range.from, range.to);
      rangeCursor += 1;
    });
  }, {
    detail: root.className,
  });
}

function collectSourceBlockAssignments(
  editor: LexicalEditor,
  doc: string,
): Map<string, SourceBlockPositionAssignment> {
  const ranges = collectSourceBlockRanges(doc);
  return editor.getEditorState().read(() => {
    const blocks: SourceBlockModelIdentity[] = [];
    for (const node of $getRoot().getChildren()) {
      if ($isRawBlockNode(node)) {
        blocks.push({
          nodeKey: node.getKey(),
          raw: node.getRaw(),
          variant: node.getVariant(),
        });
        continue;
      }
      if ($isTableNode(node)) {
        blocks.push({
          nodeKey: node.getKey(),
          variant: "table" as const,
        });
      }
    }
    return assignSourceBlockRangesToModelBlocks(blocks, ranges);
  });
}

function hasCompleteSourceBlockRanges(root: HTMLElement): boolean {
  const elements = [...root.querySelectorAll<HTMLElement>(SOURCE_BLOCK_SELECTOR)]
    .filter((element) => element.closest(".cf-lexical-root") === root);
  return elements.length > 0 && elements.every((element) =>
    readSourceFrom(element) !== null && readSourceTo(element) !== null
  );
}

function selectNavigationTarget(
  editor: LexicalEditor,
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
      target.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    });
  }

  return didSelect;
}

/**
 * Read the current Lexical selection and translate it to a source-document
 * offset using block-level position markers (`data-coflat-source-from`,
 * `data-coflat-heading-pos`). Returns `null` if the selection cannot be
 * mapped back to a source offset (e.g. the doc is pure prose with no
 * tagged blocks).
 */
export function readSourcePositionFromLexicalSelection(
  editor: LexicalEditor,
): number | null {
  return editor.getEditorState().read(() => $readSourcePositionFromLexicalSelection(editor));
}

export function $readSourcePositionFromLexicalSelection(
  editor: LexicalEditor,
): number | null {
  const selection = $getSelection();
  if ($isRangeSelection(selection)) {
    const anchorElement = editor.getElementByKey(selection.anchor.getNode().getKey());
    return sourcePositionFromElement(anchorElement);
  }

  if ($isNodeSelection(selection)) {
    const [node] = selection.getNodes();
    if (!node) {
      return null;
    }

    const element = editor.getElementByKey(node.getKey());
    return sourcePositionFromElement(element);
  }

  return null;
}

export function scrollSourcePositionIntoView(
  editor: LexicalEditor,
  root: HTMLElement | null,
  pos: number,
): boolean {
  if (!root) {
    return false;
  }

  const heading = [...root.querySelectorAll<HTMLElement>(HEADING_SOURCE_SELECTOR)]
    .find((candidate) => sourcePositionFromElement(candidate) === pos);
  if (heading) {
    return selectNavigationTarget(editor, heading);
  }

  const rawBlocks = [...root.querySelectorAll<HTMLElement>(SOURCE_BLOCK_SELECTOR)];
  let target: HTMLElement | null = null;
  for (const block of rawBlocks) {
    const start = readSourceFrom(block);
    const end = readSourceTo(block);
    if (start === null || end === null) {
      continue;
    }
    if (start <= pos && pos <= end) {
      target = block;
      break;
    }
  }

  if (!target) {
    return false;
  }

  return selectNavigationTarget(editor, target);
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
  const didScheduleInitialSyncRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      if (cancelled) {
        return;
      }
      const root = editor.getRootElement();
      if (
        root
        && consumeIncrementalSourcePositionSync(root)
        && hasCompleteSourceBlockRanges(root)
      ) {
        return;
      }
      syncSourceBlockPositions(
        root,
        syncToken.doc,
        collectSourceBlockAssignments(editor, syncToken.doc),
      );
    };

    sync();
    if (!didScheduleInitialSyncRef.current) {
      didScheduleInitialSyncRef.current = true;
      queueMicrotask(sync);
      requestAnimationFrame(sync);
    }
    return () => {
      cancelled = true;
    };
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
