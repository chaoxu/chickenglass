/**
 * Hook: Knuth-Plass optimal line breaking for read-mode paragraphs.
 *
 * Applies tex-linebreak2 after each HTML render and re-applies on container
 * resize (debounced). Paragraphs containing inline math (.katex) are skipped —
 * they fall back to CSS text-align:justify + Hyphenopoly soft hyphens.
 */

import { useEffect, useCallback, type RefObject } from "react";
import {
  texLinebreakDOM,
  resetDOMJustification,
} from "tex-linebreak2";
import { measureAsync } from "../perf";

/** Debounce delay (ms) for re-applying line breaking on resize. */
const RESIZE_DEBOUNCE_MS = 200;

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
 * Apply Knuth-Plass line breaking after each HTML render and re-apply
 * on container resize (debounced at 200 ms).
 */
export function useLineBreaking(
  containerRef: RefObject<HTMLElement | null>,
  htmlContent: string,
): void {
  // Stable callback for applying line breaking (used by both effect and resize observer)
  const applyLineBreakingCb = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    measureAsync("read_mode.line_breaking", () => applyLineBreaking(el), {
      category: "read_mode",
    }).catch(() => {
      // Silently ignore line-breaking errors — CSS justify is the fallback
    });
  }, [containerRef]);

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
  }, [applyLineBreakingCb, containerRef]);
}
