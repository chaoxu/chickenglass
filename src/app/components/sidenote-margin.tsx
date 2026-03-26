/**
 * SidenoteMargin — Gwern-style margin column for footnote sidenotes.
 *
 * Renders sidenotes as a React portal INSIDE the CM6 .cm-scroller element.
 * This means sidenotes share the editor's scroll container — mouse wheel
 * scrolling works everywhere and the scrollbar spans the full width.
 *
 * Positions are in document coordinates (px from content top), so they
 * scroll naturally with no manual sync needed.
 */

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { EditorView } from "@codemirror/view";
import { collectFootnotes, mathMacrosField } from "../../render";
import { orderedFootnoteEntries } from "../../semantics/document";
import { renderDocumentFragmentToDom } from "../../document-surfaces";

interface SidenoteEntry {
  id: string;
  number: number;
  content: string;
  /** Y of the footnote ref in the editor (px, relative to document top). */
  anchorY: number;
  /** Start position of the footnote definition in the document (for click-to-edit). */
  defFrom: number;
}

interface SidenoteMarginProps {
  view: EditorView | null;
}

const GAP = 8;

function extractSidenotes(view: EditorView): SidenoteEntry[] {
  const state = view.state;
  const footnotes = collectFootnotes(state);

  const entries: SidenoteEntry[] = [];

  for (const entry of orderedFootnoteEntries(footnotes)) {
    const firstRef = footnotes.refs.find((ref) => ref.id === entry.id);
    if (!firstRef) continue;

    // lineBlockAt returns document-coordinate top that works for off-screen positions
    const block = view.lineBlockAt(firstRef.from);
    const anchorY = block.top;

    entries.push({
      id: entry.id,
      number: entry.number,
      content: entry.def.content,
      anchorY,
      defFrom: entry.def.from,
    });
  }

  entries.sort((a, b) => a.anchorY - b.anchorY);
  return entries;
}

/** React wrapper around the shared document-surface renderer. */
function SidenoteContent({ text, macros }: { text: string; macros: Record<string, string> }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = "";
    renderDocumentFragmentToDom(ref.current, {
      kind: "footnote",
      text,
      macros,
    });
  }, [text, macros]);
  return <span ref={ref} />;
}

export function SidenoteMargin({ view }: SidenoteMarginProps) {
  const [entries, setEntries] = useState<SidenoteEntry[]>([]);
  const [positions, setPositions] = useState<number[]>([]);
  const [portalTarget, setPortalTarget] = useState<HTMLDivElement | null>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Create a container div inside the CM6 scroller for our sidenotes
  useEffect(() => {
    if (!view) {
      setPortalTarget(null);
      return;
    }

    const scroller = view.scrollDOM;
    // Check if we already have a container
    let container = scroller.querySelector(".cf-sidenote-portal") as HTMLDivElement | null;
    if (!container) {
      container = document.createElement("div");
      container.className = "cf-sidenote-portal";
      scroller.style.position = "relative";
      scroller.appendChild(container);
    }

    setPortalTarget(container);

    return () => {
      // Clean up on unmount
      if (container && container.parentElement) {
        container.parentElement.removeChild(container);
      }
    };
  }, [view]);

  // Track document version so we re-extract sidenotes on every edit,
  // including same-length replacements that doc.length would miss.
  // CM6 Text objects are immutable — identity comparison catches all changes.
  const [docVersion, setDocVersion] = useState(0);
  useEffect(() => {
    if (!view) return;
    let prevDoc = view.state.doc;
    let rafId: number | null = null;
    const check = () => {
      if (view.state.doc !== prevDoc) {
        prevDoc = view.state.doc;
        setDocVersion((v) => v + 1);
      }
      rafId = requestAnimationFrame(check);
    };
    rafId = requestAnimationFrame(check);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [view]);

  // Extract sidenotes whenever doc changes
  useEffect(() => {
    if (!view) {
      setEntries([]);
      return;
    }
    setEntries(extractSidenotes(view));
  }, [view, docVersion]);

  // Re-extract on scroll (positions may change due to folding/viewport)
  // Uses rAF-based throttling to limit extractSidenotes() to once per frame
  useEffect(() => {
    if (!view) return;

    let rafId: number | null = null;

    const handleScroll = () => {
      if (rafId !== null) return; // already scheduled for this frame
      rafId = requestAnimationFrame(() => {
        rafId = null;
        setEntries(extractSidenotes(view));
      });
    };

    view.scrollDOM.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      view.scrollDOM.removeEventListener("scroll", handleScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [view]);

  const macros = useMemo(() => {
    if (!view) return {};
    return view.state.field(mathMacrosField, false) ?? {};
    // docVersion ensures macros recompute when frontmatter changes,
    // even if the edit doesn't change doc.length.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, docVersion]);

  const setItemRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) {
      itemRefs.current.set(id, el);
    } else {
      itemRefs.current.delete(id);
    }
  }, []);

  // Two-pass: after render, measure actual heights and recompute positions
  useEffect(() => {
    if (entries.length === 0) {
      setPositions([]);
      return;
    }

    const rafId = requestAnimationFrame(() => {
      const result: number[] = [];
      let nextAvailableY = 0;

      for (const entry of entries) {
        const targetY = Math.max(entry.anchorY, nextAvailableY);
        result.push(targetY);

        const el = itemRefs.current.get(entry.id);
        const actualHeight = el ? el.offsetHeight : 40;
        nextAvailableY = targetY + actualHeight + GAP;
      }

      setPositions(result);
    });

    return () => cancelAnimationFrame(rafId);
  }, [entries]);

  if (!portalTarget || entries.length === 0) return null;

  return createPortal(
    <>
      {entries.map((entry, i) => {
        const docY = positions[i] ?? entry.anchorY;
        return (
          <div
            key={entry.id}
            ref={(el) => setItemRef(entry.id, el)}
            role="button"
            tabIndex={0}
            aria-label={`Footnote ${entry.number}: navigate to definition`}
            onClick={() => {
              if (!view) return;
              // Focus first so the editor knows it's focused when rebuilding decorations
              view.focus();
              // Place cursor at the definition line — this triggers decoration rebuild
              // which un-collapses the line since cursor is now inside the def range
              view.dispatch({
                selection: { anchor: entry.defFrom },
              });
              // Scroll after the line has been un-collapsed (next frame)
              requestAnimationFrame(() => {
                view.dispatch({ effects: EditorView.scrollIntoView(entry.defFrom) });
              });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (!view) return;
                view.focus();
                view.dispatch({ selection: { anchor: entry.defFrom } });
                requestAnimationFrame(() => {
                  view.dispatch({ effects: EditorView.scrollIntoView(entry.defFrom) });
                });
              }
            }}
            className="cf-sidenote-entry"
            style={{ top: `${docY}px` }}
          >
            <span className="cf-sidenote-entry-number">
              {entry.number}
            </span>
            <SidenoteContent text={entry.content} macros={macros} />
          </div>
        );
      })}
    </>,
    portalTarget,
  );
}
