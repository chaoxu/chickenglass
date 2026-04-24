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
import {
  collectSourceBlockRanges,
  type SourceBlockRange,
} from "./markdown/block-scanner";
import { $isRawBlockNode } from "./nodes/raw-block-node";
import { $isTableNode } from "./nodes/table-node";
import {
  assignSourceBlockRangesToModelBlocks,
  type SourceBlockModelIdentity,
  type SourceBlockPositionAssignment,
} from "./source-block-position-assignment";
import {
  HEADING_SOURCE_SELECTOR,
  readSourceFrom,
  readSourceTo,
  SOURCE_BLOCK_SELECTOR,
} from "./source-position-contract";
import { sourcePositionFromElement } from "./source-position-dom";
import { consumeIncrementalSourcePositionSync } from "./source-position-incremental-sync";
import {
  hasCompleteSourceBlockRanges,
  hasSourceBlockElements,
  syncSourceBlockPositions,
} from "./source-block-position-sync";

export { readSourcePositionFromElement } from "./source-position-dom";
export {
  mapVisibleTextOffsetToMarkdown,
  readSourceSelectionFromLexicalSelection,
  selectSourceOffsetsInRichLexicalNode,
  selectSourceOffsetsInRichLexicalRoot,
} from "./source-selection";
export { syncSourceBlockPositions } from "./source-block-position-sync";

function collectSourceBlockAssignments(
  editor: LexicalEditor,
  ranges: readonly SourceBlockRange[],
): Map<string, SourceBlockPositionAssignment> {
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
      if (!hasSourceBlockElements(root)) {
        return;
      }
      const ranges = collectSourceBlockRanges(syncToken.doc);
      syncSourceBlockPositions(
        root,
        syncToken.doc,
        collectSourceBlockAssignments(editor, ranges),
        ranges,
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
