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

import { useRef, useEffect, useMemo, useCallback, useState } from "react";
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
import { resolveLocalImageOverrides } from "../pdf-image-previews";
import type { FileSystem } from "../file-manager";

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

function buildReadModeHtml(
  content: string,
  frontmatterConfig: FrontmatterConfig,
  bibliography?: BibStore,
  cslProcessor?: CslProcessor,
  documentPath = "",
  imageUrlOverrides?: ReadonlyMap<string, string>,
): string {
  const bodyHtml = markdownToHtml(content, {
    macros: frontmatterConfig.math,
    sectionNumbers: true,
    bibliography,
    cslProcessor,
    documentPath,
    imageUrlOverrides,
  });

  const titleHtml = frontmatterConfig.title
    ? `<h1 class="cf-read-title">${renderDocumentFragmentToHtml({
      kind: "title",
      text: frontmatterConfig.title,
      macros: frontmatterConfig.math,
    })}</h1>`
    : "";

  return titleHtml + bodyHtml;
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
  fs,
  docPath,
}: ReadModeViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const didRestoreScroll = useRef(false);
  const resolvedDocPath = docPath ?? "";

  const baseHtmlContent = useMemo(
    () => buildReadModeHtml(content, frontmatterConfig, bibliography, cslProcessor, resolvedDocPath),
    [content, frontmatterConfig, bibliography, cslProcessor, resolvedDocPath],
  );
  const [htmlContent, setHtmlContent] = useState(baseHtmlContent);

  useEffect(() => {
    let cancelled = false;
    setHtmlContent(baseHtmlContent);

    if (!fs) return () => {
      cancelled = true;
    };

    void measureAsync("read_mode.pdf_previews", async () => {
      const imageUrlOverrides = await resolveLocalImageOverrides(content, fs, resolvedDocPath);
      if (cancelled || imageUrlOverrides.size === 0) return;
      setHtmlContent(
        buildReadModeHtml(
          content,
          frontmatterConfig,
          bibliography,
          cslProcessor,
          resolvedDocPath,
          imageUrlOverrides,
        ),
      );
    }, {
      category: "read_mode",
      detail: docPath,
    }).catch(() => {
      // Silently ignore preview-preparation errors — broken-image fallback remains.
    });

    return () => {
      cancelled = true;
    };
  }, [baseHtmlContent, bibliography, content, cslProcessor, docPath, frontmatterConfig, fs]);

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

  useEffect(() => {
    didRestoreScroll.current = false;
  }, [htmlContent]);

  // Restore scroll position after each document render.
  // Always set scrollTop (defaulting to 0) so that switching documents
  // resets the container rather than keeping the previous file's position.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || didRestoreScroll.current) return;
    didRestoreScroll.current = true;
    el.scrollTop = scrollTop ?? 0;
  }, [htmlContent, scrollTop]);

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
