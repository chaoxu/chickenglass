/**
 * Writing statistics utilities.
 *
 * Provides `computeDocStats` for computing word/character/sentence counts
 * and reading time from markdown text, plus the `DocStats` interface and
 * `formatReadingTime` helper. Used by the React StatusBar component.
 */

import { parseFrontmatter } from "../parser/frontmatter";
import { READING_WPM } from "../constants";

/** Computed document statistics. */
export interface DocStats {
  words: number;
  chars: number;
  charsNoSpaces: number;
  sentences: number;
  /** Estimated reading time in minutes (rounded up, minimum 1). */
  readingMinutes: number;
}

/**
 * Format a readingMinutes value as a human-readable string.
 * 0 → "< 1 min", 1 → "1 min", N → "N min"
 */
export function formatReadingTime(minutes: number): string {
  if (minutes === 0) return "< 1 min";
  if (minutes === 1) return "1 min";
  return `${minutes} min`;
}

/** Compute document statistics from raw markdown text. */
export function computeDocStats(text: string): DocStats {
  const { end } = parseFrontmatter(text);
  const body = end >= 0 ? text.slice(end) : text;

  // Word count
  const wordTokens = body.split(/\s+/).filter((t) => t.length > 0);
  const words = wordTokens.length;

  // Character counts
  const chars = body.length;
  const charsNoSpaces = body.replace(/\s/g, "").length;

  // Sentence count: split on sentence-ending punctuation followed by
  // whitespace or end-of-string. Minimum 1 sentence if text is non-empty.
  const sentenceMatches = body.match(/[.!?]+(?:\s|$)/g);
  const sentences = words === 0 ? 0 : Math.max(1, sentenceMatches?.length ?? 1);

  // Reading time, minimum 1 min when there are words
  const readingMinutes = words === 0 ? 0 : Math.max(1, Math.ceil(words / READING_WPM));

  return { words, chars, charsNoSpaces, sentences, readingMinutes };
}
