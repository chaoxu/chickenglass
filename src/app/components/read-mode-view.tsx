/**
 * Read mode view — renders markdown as semantic HTML in a scrollable div.
 *
 * Replaces the CM6 EditorView when the editor is in "read" mode, enabling
 * proper typography (justify, hyphens) that CM6's `.cm-line` divs prevent.
 *
 * Uses the existing `markdownToHtml` converter with math macros from
 * frontmatter and section numbering support.
 */

import { useRef, useEffect, useMemo } from "react";
import { markdownToHtml, renderInline } from "../markdown-to-html";
import { parseFrontmatter } from "../../parser/frontmatter";
import type { ProjectConfig } from "../project-config";
import { mergeConfigs } from "../project-config";

export interface ReadModeViewProps {
  /** Raw markdown document content. */
  content: string;
  /** Project-level configuration (provides default math macros, etc.). */
  projectConfig?: ProjectConfig;
  /** Scroll position to restore when entering read mode. */
  scrollTop?: number;
  /** Callback with current scroll position for persistence. */
  onScroll?: (scrollTop: number) => void;
}

/**
 * Render markdown content as semantic HTML for reading.
 *
 * Parses frontmatter directly from the content string to extract math
 * macros and title, then delegates to `markdownToHtml` for conversion.
 */
export function ReadModeView({
  content,
  projectConfig,
  scrollTop,
  onScroll,
}: ReadModeViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const didRestoreScroll = useRef(false);

  // Parse frontmatter and merge with project config for macros
  const config = useMemo(() => {
    const { config: fileConfig } = parseFrontmatter(content);
    return mergeConfigs(projectConfig ?? {}, fileConfig);
  }, [content, projectConfig]);

  // Convert markdown to HTML
  const htmlContent = useMemo(() => {
    const bodyHtml = markdownToHtml(content, {
      macros: config.math,
      sectionNumbers: true,
    });

    // Render title from frontmatter if present (renderInline handles
    // HTML escaping and inline math like $x^2$ in titles)
    const titleHtml = config.title
      ? `<h1 class="cg-read-title">${renderInline(config.title, config.math)}</h1>`
      : "";

    return titleHtml + bodyHtml;
  }, [content, config]);

  // Restore scroll position on mount
  useEffect(() => {
    const el = containerRef.current;
    if (!el || didRestoreScroll.current) return;
    didRestoreScroll.current = true;
    if (scrollTop !== undefined && scrollTop > 0) {
      el.scrollTop = scrollTop;
    }
  }, [scrollTop]);

  // Track scroll position
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !onScroll) return;

    const handler = () => {
      onScroll(el.scrollTop);
    };

    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, [onScroll]);

  return (
    <div
      ref={containerRef}
      className="cg-read-mode-view"
      dangerouslySetInnerHTML={{ __html: htmlContent }}
    />
  );
}
