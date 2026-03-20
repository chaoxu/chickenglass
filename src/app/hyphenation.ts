/**
 * Hyphenation utilities for Read mode.
 *
 * Uses Hyphenopoly (WASM-based Liang algorithm) to insert soft hyphens (\u00AD)
 * into text nodes, improving justified text layout in Read mode.
 *
 * Strategy:
 * - Initialize once (lazy) with English (en-us) patterns served from /public/
 * - Walk text nodes inside <p> elements, skipping math (.katex), code (pre/code)
 * - Apply soft hyphens via the returned hyphenateText function
 */

import hyphenopoly from "hyphenopoly";

/** Soft hyphen character inserted by Hyphenopoly */
const SOFT_HYPHEN = "\u00AD";

/** Tags whose text content must NOT be hyphenated */
const SKIP_TAGS = new Set(["PRE", "CODE", "SCRIPT", "STYLE", "MATH", "SVG"]);

/** CSS classes whose subtree must NOT be hyphenated */
const SKIP_CLASSES = ["katex", "katex-html", "math-display", "math-inline"];

/**
 * Singleton promise for the hyphenateText function.
 * Initialised on first call to getHyphenator().
 */
let hyphenatorPromise: Promise<(text: string) => string> | null = null;

/**
 * Returns (and lazily initialises) the en-us hyphenator.
 *
 * The WASM pattern file is served from /hyphenopoly/en-us.wasm (copied to
 * public/ at build time). The loader fetches it as an ArrayBuffer.
 */
export function getHyphenator(): Promise<(text: string) => string> {
  if (hyphenatorPromise !== null) {
    return hyphenatorPromise;
  }

  const resultMap = hyphenopoly.config({
    "hyphen": SOFT_HYPHEN,
    "loader": async (file: string, _patDir: URL) => {
      const res = await fetch(`/hyphenopoly/${file}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch hyphenation patterns: ${file} (${res.status})`);
      }
      return res.arrayBuffer();
    },
    "require": ["en-us"],
    "minWordLength": 6,
  });

  // resultMap is a Map<string, Promise<hyphenateTextFn>>
  const langPromise = resultMap.get("en-us") as Promise<(text: string) => string>;
  hyphenatorPromise = langPromise;
  return hyphenatorPromise;
}

/**
 * Returns true if the element (or any ancestor up to the read-mode root)
 * should be excluded from hyphenation.
 */
function shouldSkipElement(el: Element): boolean {
  if (SKIP_TAGS.has(el.tagName)) {
    return true;
  }
  for (const cls of SKIP_CLASSES) {
    if (el.classList.contains(cls)) {
      return true;
    }
  }
  return false;
}

/**
 * Walk all text nodes that are descendants of `root`, skipping any subtree
 * rooted at a math/code element. Returns an array of text nodes.
 */
function collectTextNodes(root: Element): Text[] {
  const texts: Text[] = [];
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (shouldSkipElement(node as Element)) {
            return NodeFilter.FILTER_REJECT; // skip entire subtree
          }
          return NodeFilter.FILTER_SKIP;    // descend into element
        }
        if (node.nodeType === Node.TEXT_NODE) {
          const text = (node as Text).data;
          if (text.trim().length === 0) {
            return NodeFilter.FILTER_SKIP;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
      },
    }
  );

  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    texts.push(node as Text);
  }
  return texts;
}

/**
 * Apply soft hyphens to all qualifying text nodes inside a container element.
 *
 * Only processes text inside <p> elements to avoid hyphenating headings,
 * captions, labels, etc. Math and code subtrees are skipped.
 *
 * @param container - The .cg-read-mode-view div
 * @param hyphenate - The hyphenateText function from Hyphenopoly
 */
export function applyHyphensToContainer(
  container: Element,
  hyphenate: (text: string) => string
): void {
  // Only hyphenate paragraphs for now — headings, titles, captions stay clean
  const paragraphs = container.querySelectorAll("p");
  for (const para of paragraphs) {
    const textNodes = collectTextNodes(para);
    for (const textNode of textNodes) {
      const original = textNode.data;
      const hyphenated = hyphenate(original);
      if (hyphenated !== original) {
        textNode.data = hyphenated;
      }
    }
  }
}
