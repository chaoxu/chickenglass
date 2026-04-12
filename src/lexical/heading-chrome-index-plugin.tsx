import { useEffect, useMemo } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

import { headingEntriesEqual, type HeadingEntry } from "../app/markdown/headings";
import { useHeadingIndexStore } from "../app/stores/heading-index-store";
import { syncHeadingChrome } from "./heading-chrome-plugin";
import { $collectHeadingEntries, mergeHeadingDomPositions } from "./heading-index-plugin";

// Single update-driven sync for both heading DOM chrome
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

    const unregister = editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
      // Cursor-only updates can't add/remove/renumber a heading, so skipping
      // them avoids a per-keystroke DOM write and heading walk.
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
      sync();
    });

    return () => {
      unregister();
      store.getState().reset();
    };
  }, [editor, syncToken]);

  return null;
}
