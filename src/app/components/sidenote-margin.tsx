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
import {
  collectFootnotes,
  splitByInlineMath,
} from "../../render/sidenote-render";
import katex from "katex";
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

/** Render a plain-text segment with bold/italic markdown. */
function InlineMarkdown({ text }: { text: string }) {
  const parts: Array<{ type: "text" | "bold" | "italic"; content: string }> = [];
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      parts.push({ type: "text", content: text.slice(last, match.index) });
    }
    if (match[1] !== undefined) {
      parts.push({ type: "bold", content: match[1] });
    } else if (match[2] !== undefined) {
      parts.push({ type: "italic", content: match[2] });
    }
    last = regex.lastIndex;
  }
  if (last < text.length) {
    parts.push({ type: "text", content: text.slice(last) });
  }
  return (
    <>
      {parts.map((p, i) =>
        p.type === "bold" ? (
          <strong key={i}>{p.content}</strong>
        ) : p.type === "italic" ? (
          <em key={i}>{p.content}</em>
        ) : (
          <span key={i}>{p.content}</span>
        ),
      )}
    </>
  );
}

function SidenoteContent({ text, macros }: { text: string; macros: Record<string, string> }) {
  const segments = splitByInlineMath(text);
  return (
    <>
      {segments.map((seg, i) =>
        seg.isMath ? (
          <span
            key={i}
            dangerouslySetInnerHTML={{
              __html: katex.renderToString(seg.content, {
                throwOnError: false,
                displayMode: false,
                macros,
              }),
            }}
          />
        ) : (
          <InlineMarkdown key={i} text={seg.content} />
        ),
      )}
    </>
  );
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
        "height: 0",       // doesn't need height — children are absolute
        "overflow: visible",
        "pointer-events: none",  // let clicks pass through to editor
        "z-index: 1",
        "box-sizing: border-box",
      ].join(";");

      // Visual separator line between editor content and sidenote column
      const separator = document.createElement("div");
      separator.className = "cg-sidenote-separator";
      separator.style.cssText = [
        "position: absolute",
        "top: 0",
        "left: 0",
        "width: 1px",
        "height: 100000px", // large fixed height — parent has height:0 + overflow:visible
        "background: var(--cg-border)",
        "opacity: 0.5",
        "pointer-events: none",
      ].join(";");
      container.appendChild(separator);

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
  useEffect(() => {
    if (!view) return;

    const handleScroll = () => {
      setEntries(extractSidenotes(view));
    };

    view.scrollDOM.addEventListener("scroll", handleScroll, { passive: true });
    return () => view.scrollDOM.removeEventListener("scroll", handleScroll);
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
