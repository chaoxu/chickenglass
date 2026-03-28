/**
 * Read mode view — renders markdown as semantic HTML in a scrollable div.
 *
 * Replaces the CM6 EditorView when the editor is in "read" mode, enabling
 * proper typography (justify, hyphens) that CM6's `.cm-line` divs prevent.
 *
 * The post-render pipeline is decomposed into focused hooks:
 *   useReadModeHtml   — HTML generation + async image override resolution
 *   useLineBreaking   — Knuth-Plass optimal line breaking + resize reflow
 *   useScrollRestore  — scroll position restoration across document switches
 *   useHyphenation    — Hyphenopoly soft-hyphen insertion
 *   useScrollTracking — passive scroll position reporting
 *   useLinkInterception — external link click interception (Tauri)
 */

import { useRef } from "react";
import type { BibStore } from "../../citations/citation-render";
import type { FrontmatterConfig } from "../../parser/frontmatter";
import type { CslProcessor } from "../../citations/csl-processor";
import type { FileSystem } from "../file-manager";
import { useReadModeHtml } from "../hooks/use-read-mode-html";
import { useLineBreaking } from "../hooks/use-line-breaking";
import { useScrollRestore } from "../hooks/use-scroll-restore";
import { useHyphenation } from "../hooks/use-hyphenation";
import { useScrollTracking } from "../hooks/use-scroll-tracking";
import { useLinkInterception } from "../hooks/use-link-interception";

export interface ReadModeViewProps {
  /** Raw markdown document content. */
  content: string;
  /** Merged frontmatter config from the CM6 state (project + file already merged). */
  frontmatterConfig: FrontmatterConfig;
  /** Loaded bibliography entries for citation resolution. */
  bibliography?: BibStore;
  /** CSL processor used by rich mode citation rendering. */
  cslProcessor?: CslProcessor;
  /** Scroll position to restore when entering read mode. */
  scrollTop?: number;
  /** Callback with current scroll position for persistence. */
  onScroll?: (scrollTop: number) => void;
  /** FileSystem used for preparing local image URLs for read mode. */
  fs?: FileSystem;
  /** Current document path for resolving relative image targets. */
  docPath?: string;
}

/**
 * Render markdown content as semantic HTML for reading.
 *
 * Receives the already-merged frontmatter config from CM6 state (via
 * the `frontmatterConfig` prop) for math macros and title, then
 * delegates to `markdownToHtml` for conversion. After the DOM renders,
 * applies Knuth-Plass optimal line breaking to all paragraph elements
 * for book-quality justified text.
 */
export function ReadModeView({
  content,
  frontmatterConfig,
  bibliography,
  cslProcessor,
  scrollTop,
  onScroll,
  fs,
  docPath,
}: ReadModeViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const htmlContent = useReadModeHtml(content, frontmatterConfig, bibliography, cslProcessor, docPath, fs);
  useLineBreaking(containerRef, htmlContent);
  useScrollRestore(containerRef, htmlContent, scrollTop);
  useHyphenation(containerRef, htmlContent);
  useScrollTracking(containerRef, onScroll);
  useLinkInterception(containerRef);

  return (
    <div
      ref={containerRef}
      className="cf-read-mode-view"
      dangerouslySetInnerHTML={{ __html: htmlContent }}
    />
  );
}
