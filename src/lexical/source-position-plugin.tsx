import { useEffect, useMemo } from "react";
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
import { collectSourceBlockRanges } from "./markdown/block-scanner";
import { $isRawBlockNode } from "./nodes/raw-block-node";

const SOURCE_BLOCK_SELECTOR = "[data-coflat-raw-block='true'], [data-coflat-table-block='true']";

export function syncSourceBlockPositions(root: HTMLElement | null, doc: string): void {
  if (!root) {
    return;
  }

  const starts = collectSourceBlockRanges(doc).map((range) => range.from);
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

function sourcePositionFromMarkedElement(element: HTMLElement | null): number | null {
  if (!element) {
    return null;
  }

  const sourceFrom = element.dataset.coflatSourceFrom;
  if (sourceFrom !== undefined) {
    const parsed = Number(sourceFrom);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  if (element.classList.contains("cf-lexical-heading")) {
    const headingPos = element.dataset.coflatHeadingPos;
    if (headingPos !== undefined) {
      const parsed = Number(headingPos);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

function sourcePositionFromElement(element: HTMLElement | null): number | null {
  const markedDescendant = element?.querySelector<HTMLElement>(
    "[data-coflat-source-from], .cf-lexical-heading[data-coflat-heading-pos]",
  ) ?? null;
  const descendantPosition = sourcePositionFromMarkedElement(markedDescendant);
  if (descendantPosition !== null) {
    return descendantPosition;
  }

  let current: HTMLElement | null = element;
  while (current) {
    const currentPosition = sourcePositionFromMarkedElement(current);
    if (currentPosition !== null) {
      return currentPosition;
    }
    current = current.parentElement;
  }
  return null;
}

export function readSourcePositionFromElement(
  element: HTMLElement | null,
): number | null {
  return sourcePositionFromElement(element);
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

  const heading = root.querySelector<HTMLElement>(`.cf-lexical-heading[data-coflat-heading-pos="${String(pos)}"]`);
  if (heading) {
    return selectNavigationTarget(editor, heading);
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
