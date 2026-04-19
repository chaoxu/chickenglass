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
import { sourcePositionFromElement } from "./source-position-dom";

const SOURCE_BLOCK_SELECTOR = "[data-coflat-raw-block='true'], [data-coflat-table-block='true']";

export { readSourcePositionFromElement } from "./source-position-dom";
export {
  readSourceSelectionFromLexicalSelection,
  selectSourceOffsetsInRichLexicalRoot,
} from "./source-selection";

export function syncSourceBlockPositions(root: HTMLElement | null, doc: string): void {
  if (!root) {
    return;
  }

  const ranges = collectSourceBlockRanges(doc);
  const elements = [...root.querySelectorAll<HTMLElement>(SOURCE_BLOCK_SELECTOR)]
    .filter((element) => element.closest(".cf-lexical-root") === root);

  elements.forEach((element, index) => {
    const range = ranges[index];
    if (!range) {
      delete element.dataset.coflatSourceFrom;
      delete element.dataset.coflatSourceTo;
      return;
    }
    element.dataset.coflatSourceFrom = String(range.from);
    element.dataset.coflatSourceTo = String(range.to);
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

  const heading = root.querySelector<HTMLElement>(`.cf-lexical-heading[data-coflat-heading-pos="${String(pos)}"]`);
  if (heading) {
    return selectNavigationTarget(editor, heading);
  }

  const rawBlocks = [...root.querySelectorAll<HTMLElement>("[data-coflat-source-from]")];
  let target: HTMLElement | null = null;
  for (const block of rawBlocks) {
    const start = Number(block.dataset.coflatSourceFrom ?? "");
    const end = Number(block.dataset.coflatSourceTo ?? "");
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
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
