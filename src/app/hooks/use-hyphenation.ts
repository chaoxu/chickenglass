/**
 * Hook: Hyphenopoly soft-hyphen insertion for read mode.
 *
 * Applies soft hyphens to text nodes in `<p>` elements after each HTML render.
 * Math (.katex), code, and script subtrees are excluded. Falls back to CSS
 * hyphens:auto if Hyphenopoly fails to load.
 */

import { useEffect, type RefObject } from "react";
import { getHyphenator, applyHyphensToContainer } from "../hyphenation";
import { measureSync } from "../perf";

export function useHyphenation(
  containerRef: RefObject<HTMLElement | null>,
  htmlContent: string,
): void {
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
  }, [htmlContent, containerRef]);
}
