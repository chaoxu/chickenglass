import { useEffect, useMemo } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isHeadingNode, HeadingNode } from "@lexical/rich-text";
import {
  $getNodeByKey,
  $isRootNode,
  mergeRegister,
  type EditorState,
  type LexicalNode,
  type NodeMutation,
  type NodeKey,
  TextNode,
} from "lexical";

import { headingEntriesEqual, type HeadingEntry } from "../app/markdown/headings";
import { useHeadingIndexStore } from "../state/heading-index-store";
import { syncHeadingChrome } from "./heading-chrome-plugin";
import { $collectHeadingEntries, mergeHeadingDomPositions } from "./heading-index-plugin";

function $nodeOrAncestorIsHeading(node: LexicalNode | null): boolean {
  let current: LexicalNode | null = node;
  while (current) {
    if ($isHeadingNode(current)) {
      return true;
    }
    if ($isRootNode(current)) {
      return false;
    }
    current = current.getParent();
  }
  return false;
}

function textMutationsMayAffectHeadings(
  editorState: EditorState,
  previousEditorState: EditorState,
  mutations: ReadonlyMap<NodeKey, NodeMutation>,
): boolean {
  if (mutations.size === 0) {
    return false;
  }

  let affectsHeadings = false;
  editorState.read(() => {
    for (const key of mutations.keys()) {
      if ($nodeOrAncestorIsHeading($getNodeByKey(key))) {
        affectsHeadings = true;
        return;
      }
    }
  });

  if (affectsHeadings) {
    return true;
  }

  previousEditorState.read(() => {
    for (const [key, mutation] of mutations) {
      if (mutation === "destroyed" && $nodeOrAncestorIsHeading($getNodeByKey(key))) {
        affectsHeadings = true;
        return;
      }
    }
  });

  return affectsHeadings;
}

// Single mutation-aware sync for both heading DOM chrome
// (`data-coflat-heading-*` attributes) and the Zustand heading index store.
// Collapsing what used to be two separate plugins into one avoids walking the
// heading list twice per keystroke and keeps DOM attributes and store entries
// in lock-step, since the index merges `pos` values back from DOM attributes
// that chrome writes in the same sync pass.
export function HeadingChromeAndIndexPlugin({
  doc,
}: {
  readonly doc: string;
}) {
  const [editor] = useLexicalComposerContext();
  const syncToken = useMemo(() => ({ doc }), [doc]);

  useEffect(() => {
    const store = useHeadingIndexStore;
    let prev: HeadingEntry[] = [];

    const sync = () => {
      const rootElement = editor.getRootElement();
      syncHeadingChrome(rootElement, syncToken.doc);
      let entries: Omit<HeadingEntry, "pos">[] = [];
      editor.read(() => {
        entries = $collectHeadingEntries();
      });
      const headings = mergeHeadingDomPositions(entries, rootElement);
      if (!headingEntriesEqual(prev, headings)) {
        prev = headings;
        store.getState().setHeadings(headings);
      }
    };

    sync();

    const unregisterMutationListener = mergeRegister(
      editor.registerMutationListener(
        HeadingNode,
        (mutations) => {
          if (mutations.size > 0) {
            sync();
          }
        },
      ),
      editor.registerMutationListener(
        TextNode,
        (mutations, { prevEditorState }) => {
          if (
            textMutationsMayAffectHeadings(
              editor.getEditorState(),
              prevEditorState,
              mutations,
            )
          ) {
            sync();
          }
        },
      ),
    );

    return () => {
      unregisterMutationListener();
      store.getState().reset();
    };
  }, [editor, syncToken]);

  return null;
}
