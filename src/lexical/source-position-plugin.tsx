import { useEffect, useMemo, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createNodeSelection,
  $getNearestNodeFromDOMNode,
  $getSelection,
  $isNodeSelection,
  $isRangeSelection,
  $setSelection,
  type LexicalEditor,
} from "lexical";

import {
  NAVIGATE_SOURCE_POSITION_EVENT,
  type NavigateSourcePositionEventDetail,
} from "../constants/events";
import { measureSync } from "../app/perf";
import { collectSourceBlockRanges } from "./markdown/block-scanner";
import { $isRawBlockNode } from "./nodes/raw-block-node";
import { sourcePositionFromElement } from "./source-position-dom";
import {
  clearSourceRange,
  HEADING_SOURCE_SELECTOR,
  readSourceFrom,
  readSourceTo,
  setSourceRange,
  SOURCE_BLOCK_SELECTOR,
} from "./source-position-contract";
import { consumeIncrementalSourcePositionSync } from "./source-position-incremental-sync";
import { COFLAT_INCREMENTAL_DOC_CHANGE_TAG } from "./update-tags";

export { readSourcePositionFromElement } from "./source-position-dom";
export {
  readSourceSelectionFromLexicalSelection,
  selectSourceOffsetsInRichLexicalRoot,
} from "./source-selection";

export function syncSourceBlockPositions(root: HTMLElement | null, doc: string): void {
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
    elements.forEach((element, index) => {
      const range = ranges[index];
      if (!range) {
        clearSourceRange(element);
        return;
      }
      setSourceRange(element, range.from, range.to);
    });
  }, {
    detail: root.className,
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
      syncSourceBlockPositions(root, syncToken.doc);
    };

    sync();
    if (!didScheduleInitialSyncRef.current) {
      didScheduleInitialSyncRef.current = true;
      queueMicrotask(sync);
      requestAnimationFrame(sync);
    }
    const unregister = editor.registerUpdateListener(({ tags }) => {
      if (tags.has(COFLAT_INCREMENTAL_DOC_CHANGE_TAG)) {
        return;
      }
      sync();
    });
    return () => {
      cancelled = true;
      unregister();
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
