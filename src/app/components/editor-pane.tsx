import { useRef, useEffect, useCallback } from "react";
import { useEditor } from "../hooks/use-editor";
import type { UseEditorOptions, UseEditorReturn } from "../hooks/use-editor";
import { Breadcrumbs } from "./breadcrumbs";
import { SidenoteMargin } from "./sidenote-margin";
import { extractHeadings } from "../heading-ancestry";
import { collectFootnotes, sidenotesCollapsedEffect } from "../../render/sidenote-render";

export interface EditorPaneProps extends UseEditorOptions {
  sidenotesCollapsed?: boolean;
  onSidenotesCollapsedChange?: (collapsed: boolean) => void;
  onStateChange?: (state: UseEditorReturn) => void;
}

export function EditorPane({ onStateChange, sidenotesCollapsed, onSidenotesCollapsedChange, ...editorOptions }: EditorPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorState = useEditor(containerRef, editorOptions);

  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => { onStateChangeRef.current = onStateChange; }, [onStateChange]);

  const { view, wordCount, cursorPos, scrollTop, viewportFrom } = editorState;
  const prevRef = useRef({ wordCount: -1, cursorPos: -1, scrollTop: -1, hasView: false });

  useEffect(() => {
    const prev = prevRef.current;
    const hasView = view !== null;
    if (
      prev.wordCount === wordCount &&
      prev.cursorPos === cursorPos &&
      prev.scrollTop === scrollTop &&
      prev.hasView === hasView
    ) return;
    prevRef.current = { wordCount, cursorPos, scrollTop, hasView };
    onStateChangeRef.current?.(editorState);
  }, [view, wordCount, cursorPos, scrollTop, editorState]);

  // Extract headings for breadcrumbs and outline
  const headings = view ? extractHeadings(view.state) : [];

  // Sync collapsed state to CM6 StateField + adjust marginRight
  useEffect(() => {
    if (!view) return;
    const collapsed = sidenotesCollapsed ?? false;
    view.dispatch({ effects: sidenotesCollapsedEffect.of(collapsed) });
    view.contentDOM.style.marginRight = collapsed ? "auto" : "";
  }, [view, sidenotesCollapsed]);

  // Auto-collapse sidenote margin when editor is too narrow
  const AUTO_COLLAPSE_WIDTH = 700;
  useEffect(() => {
    if (!view || !onSidenotesCollapsedChange) return;
    const container = view.dom.parentElement;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        if (width < AUTO_COLLAPSE_WIDTH && !sidenotesCollapsed) {
          onSidenotesCollapsedChange(true);
        } else if (width >= AUTO_COLLAPSE_WIDTH && sidenotesCollapsed) {
          onSidenotesCollapsedChange(false);
        }
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [view, sidenotesCollapsed, onSidenotesCollapsedChange]);

  // Hover tooltip for sidenote refs when margin is collapsed.
  // Manual positioning via getBoundingClientRect is sufficient — the tooltip
  // is small (max-width 320px), pointer-events:none, and only appears on
  // hover. @floating-ui was evaluated (#180, #189) but rejected for this
  // use case: minimal collision risk and the bundle cost (~8KB) is not
  // justified for 2 trivial positioning sites in the codebase.
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const getFootnoteContent = useCallback((id: string): string | null => {
    if (!view) return null;
    const { defs } = collectFootnotes(view.state);
    const def = defs.get(id);
    return def ? def.content : null;
  }, [view]);

  useEffect(() => {
    if (!view || !sidenotesCollapsed) return;

    const scroller = view.scrollDOM;
    let tooltip: HTMLDivElement | null = null;

    const show = (target: HTMLElement) => {
      const id = target.getAttribute("data-footnote-id");
      if (!id) return;
      const content = getFootnoteContent(id);
      if (!content) return;

      if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.className = "cg-hover-preview";
        tooltip.style.cssText = "position:fixed;z-index:1000;background:var(--cg-bg);border:1px solid var(--cg-border);border-radius:2px;pointer-events:none;max-width:320px;padding:8px 12px;font-size:0.8em;line-height:1.5;color:var(--cg-muted);font-family:'IBM Plex Mono','Fira Code',monospace";
        document.body.appendChild(tooltip);
      }
      tooltip.textContent = content;
      const rect = target.getBoundingClientRect();
      tooltip.style.left = `${rect.left}px`;
      tooltip.style.top = `${rect.bottom + 4}px`;
      tooltipRef.current = tooltip;
    };

    const hide = () => {
      if (tooltip) {
        tooltip.remove();
        tooltip = null;
        tooltipRef.current = null;
      }
    };

    const onOver = (e: Event) => {
      const target = (e as MouseEvent).target as HTMLElement;
      if (target.classList.contains("cg-sidenote-ref")) show(target);
    };
    const onOut = (e: Event) => {
      const target = (e as MouseEvent).target as HTMLElement;
      if (target.classList.contains("cg-sidenote-ref")) hide();
    };

    scroller.addEventListener("mouseover", onOver);
    scroller.addEventListener("mouseout", onOut);
    return () => {
      scroller.removeEventListener("mouseover", onOver);
      scroller.removeEventListener("mouseout", onOut);
      hide();
    };
  }, [view, sidenotesCollapsed, getFootnoteContent]);

  return (
    <div className="flex-1 overflow-hidden relative" style={{ minHeight: 0 }}>
      <Breadcrumbs
        headings={headings}
        onSelect={(from) => {
          if (view) {
            view.dispatch({ selection: { anchor: from }, scrollIntoView: true });
            view.focus();
          }
        }}
        scrollTop={scrollTop}
        viewportFrom={viewportFrom}
      />
      <div ref={containerRef} className="h-full" />
      {/* Portal target — SidenoteMargin renders into the CM6 scroller via DOM portal */}
      {!sidenotesCollapsed && <SidenoteMargin view={view} />}
    </div>
  );
}
