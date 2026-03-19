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
import { collectFootnotes } from "../../render/sidenote-render";
import { renderInlineMarkdown } from "../../render/inline-render";
import { getMathMacros } from "../../render/math-macros";

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
const MARGIN_WIDTH = 224; // w-56 = 14rem = 224px

function extractSidenotes(view: EditorView): SidenoteEntry[] {
  const state = view.state;
  const { refs, defs } = collectFootnotes(state);

  const numberMap = new Map<string, number>();
  let nextNum = 1;
  for (const ref of refs) {
    if (!numberMap.has(ref.id)) numberMap.set(ref.id, nextNum++);
  }

  const entries: SidenoteEntry[] = [];

  for (const ref of refs) {
    const def = defs.get(ref.id);
    if (!def) continue;
    if (entries.some((e) => e.id === ref.id)) continue;

    // lineBlockAt returns document-coordinate top that works for off-screen positions
    const block = view.lineBlockAt(ref.from);
    const anchorY = block.top;

    entries.push({
      id: ref.id,
      number: numberMap.get(ref.id) ?? 0,
      content: def.content,
      anchorY,
      defFrom: def.from,
    });
  }

  entries.sort((a, b) => a.anchorY - b.anchorY);
  return entries;
}

/** React wrapper around the shared renderInlineMarkdown DOM utility. */
function SidenoteContent({ text, macros }: { text: string; macros: Record<string, string> }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = "";
    renderInlineMarkdown(ref.current, text, macros);
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
    let container = scroller.querySelector(".cg-sidenote-portal") as HTMLDivElement | null;
    if (!container) {
      container = document.createElement("div");
      container.className = "cg-sidenote-portal";
      // Position the container to the right of the content area
      container.style.cssText = [
        "position: absolute",
        "top: 0",
        "right: 0",
        `width: ${MARGIN_WIDTH}px`,
        "height: 0",
        "overflow: visible",
        "pointer-events: none",
        "z-index: 1",
        "box-sizing: border-box",
      ].join(";");

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

  // Extract sidenotes whenever doc changes
  useEffect(() => {
    if (!view) {
      setEntries([]);
      return;
    }
    setEntries(extractSidenotes(view));
  }, [view, view?.state.doc.length]);

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
    return getMathMacros(view.state);
  }, [view, view?.state.doc.length]);

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
            style={{
              position: "absolute",
              top: `${docY}px`,
              width: "100%",
              padding: "0 12px",
              fontSize: "0.75rem",
              lineHeight: "1.625",
              color: "var(--cg-muted)",
              fontFamily: "'IBM Plex Mono', 'Fira Code', monospace",
              pointerEvents: "auto",
              cursor: "pointer",
              overflowWrap: "break-word",
              boxSizing: "border-box",
            }}
          >
            <span
              style={{
                fontWeight: 600,
                color: "var(--cg-fg)",
                fontSize: "0.7em",
                verticalAlign: "super",
                marginRight: "2px",
              }}
            >
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
