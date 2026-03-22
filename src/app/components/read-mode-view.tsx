/**
 * Read mode view — renders markdown as semantic HTML in a scrollable div.
 *
 * Replaces the CM6 EditorView when the editor is in "read" mode, enabling
 * proper typography (justify, hyphens) that CM6's `.cm-line` divs prevent.
 *
 * Uses the existing `markdownToHtml` converter with math macros from the
 * CM6 frontmatter state and section numbering support. After rendering, applies
 * Knuth-Plass optimal line breaking via tex-linebreak2 for book-quality
 * justified text.
 */

import { useRef, useEffect, useMemo, useCallback } from "react";
import { markdownToHtml } from "../markdown-to-html";
import type { BibStore } from "../../citations/citation-render";
import type { FrontmatterConfig } from "../../parser/frontmatter";
import type { CslProcessor } from "../../citations/csl-processor";
import {
  texLinebreakDOM,
  resetDOMJustification,
} from "tex-linebreak2";
import { getHyphenator, applyHyphensToContainer } from "../hyphenation";
import { measureAsync, measureSync } from "../perf";
import { renderDocumentFragmentToHtml } from "../../document-surfaces";

/** Debounce delay (ms) for re-applying line breaking on resize. */
const RESIZE_DEBOUNCE_MS = 200;

export interface ReadModeViewProps {
  /** Raw markdown document content. */
  content: string;
  /** Merged frontmatter config from the CM6 state (project + file already merged). */
  frontmatterConfig: FrontmatterConfig;
  /** Loaded bibliography entries for citation resolution. */
  bibliography?: BibStore;
  /** CSL processor used by rich mode citation rendering. */
  cslProcessor?: CslProcessor | null;
  /** Scroll position to restore when entering read mode. */
  scrollTop?: number;
  /** Callback with current scroll position for persistence. */
  onScroll?: (scrollTop: number) => void;
}

/**
 * Filter paragraphs to only those without inline math.
 * Paragraphs with .katex elements are skipped — they fall back to
 * CSS text-align:justify + Hyphenopoly soft hyphens, which handles
 * KaTeX's complex DOM without any compatibility issues.
 */
function getTextOnlyParagraphs(container: HTMLElement): HTMLElement[] {
  const result: HTMLElement[] = [];
  for (const p of container.querySelectorAll<HTMLElement>("p")) {
    if (!p.querySelector(".katex")) {
      result.push(p);
    }
  }
  return result;
}

/**
 * Apply Knuth-Plass line breaking to all `<p>` elements inside the container.
 * Resets any previous justification before re-applying so the algorithm
 * measures against the original DOM structure.
 */
async function applyLineBreaking(container: HTMLElement): Promise<void> {
  const paragraphs = container.querySelectorAll<HTMLElement>("p");
  if (paragraphs.length === 0) return;

  // Reset previous line-breaking modifications before re-measuring
  for (const p of paragraphs) {
    resetDOMJustification(p);
  }

  // Only apply Knuth-Plass to paragraphs without math — tex-linebreak2
  // cannot handle KaTeX's DOM (all placeholder approaches fail due to
  // skipWhenRendering/display:none in the rendering phase). Math paragraphs
  // fall back to CSS text-align:justify + Hyphenopoly soft hyphens.
  const textParagraphs = getTextOnlyParagraphs(container);
  if (textParagraphs.length === 0) return;

  await texLinebreakDOM(textParagraphs, {
    justify: true,
    updateOnWindowResize: false,
  });

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
}: ReadModeViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const didRestoreScroll = useRef(false);

  // Convert markdown to HTML using the already-merged frontmatter config
  const htmlContent = useMemo(() => {
    const bodyHtml = markdownToHtml(content, {
      macros: frontmatterConfig.math,
      sectionNumbers: true,
      bibliography,
      cslProcessor,
    });

    const titleHtml = frontmatterConfig.title
      ? `<h1 class="cf-read-title">${renderDocumentFragmentToHtml({
        kind: "title",
        text: frontmatterConfig.title,
        macros: frontmatterConfig.math,
      })}</h1>`
      : "";

    return titleHtml + bodyHtml;
  }, [content, frontmatterConfig, bibliography, cslProcessor]);

  // Stable callback for applying line breaking (used by both effect and resize observer)
  const applyLineBreakingCb = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    measureAsync("read_mode.line_breaking", () => applyLineBreaking(el), {
      category: "read_mode",
    }).catch(() => {
      // Silently ignore line-breaking errors — CSS justify is the fallback
    });
  }, []);

  // Apply Knuth-Plass line breaking after HTML renders to the DOM
  useEffect(() => {
    applyLineBreakingCb();
  }, [htmlContent, applyLineBreakingCb]);

  // Re-apply line breaking on container resize (debounced).
  // Skips the initial ResizeObserver callback to avoid duplicating
  // the useEffect above which already applies on first render.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let isFirstCallback = true;

    const observer = new ResizeObserver(() => {
      // ResizeObserver fires immediately on observe(); skip that first call
      // since the htmlContent effect already handles the initial application.
      if (isFirstCallback) {
        isFirstCallback = false;
        return;
      }
      if (timeoutId !== null) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        applyLineBreakingCb();
        timeoutId = null;
      }, RESIZE_DEBOUNCE_MS);
    });

    observer.observe(el);

    return () => {
      observer.disconnect();
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
  }, [applyLineBreakingCb]);

  // Restore scroll position on mount
  useEffect(() => {
    const el = containerRef.current;
    if (!el || didRestoreScroll.current) return;
    didRestoreScroll.current = true;
    if (scrollTop !== undefined && scrollTop > 0) {
      el.scrollTop = scrollTop;
    }
  }, [scrollTop]);

  // Apply Hyphenopoly soft hyphens to text nodes after HTML renders.
  // Runs after each htmlContent change. Math (.katex) and code subtrees
  // are excluded by applyHyphensToContainer.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let cancelled = false;
    getHyphenator()
      .then((hyphenate) => {
        if (!cancelled) {
          measureSync("read_mode.hyphenation", () => {
            applyHyphensToContainer(el, hyphenate);
          }, { category: "read_mode" });
        }
      })
      .catch((err: unknown) => {
        // Non-fatal: CSS hyphens:auto serves as fallback
        console.warn("Hyphenopoly failed to load:", err);
      });

    return () => {
      cancelled = true;
    };
  }, [htmlContent]);

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
      className="cf-read-mode-view"
      dangerouslySetInnerHTML={{ __html: htmlContent }}
    />
  );
}
