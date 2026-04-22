/**
 * Writing statistics utilities.
 *
 * Provides `computeDocStats` for computing word/character/sentence counts
 * and reading time from markdown text, plus the `DocStats` interface and
 * `formatReadingTime` helper. Used by the React StatusBar component.
 *
 * Uses Intl.Segmenter for word and sentence segmentation, which handles
 * CJK text and other non-Latin scripts correctly without regex heuristics.
 */

import type { Text } from "@codemirror/state";

import { parseFrontmatter } from "../parser/frontmatter";
import { READING_WPM } from "../constants";

const wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });
const sentenceSegmenter = new Intl.Segmenter(undefined, {
  granularity: "sentence",
});
const WORD_COUNT_BUFFER_LIMIT = 16_384;

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

/** Count words using Intl.Segmenter, filtering to word-like segments. */
function countWords(text: string): number {
  let count = 0;
  for (const { isWordLike } of wordSegmenter.segment(text)) {
    if (isWordLike) count++;
  }
  return count;
}

function countWordsInTextRange(doc: Text, from: number): number {
  let count = 0;
  let buffer = "";
  const flush = () => {
    if (buffer.length === 0) {
      return;
    }
    count += countWords(buffer);
    buffer = "";
  };
  const cursor = doc.iterRange(from);
  while (!cursor.next().done) {
    buffer += cursor.value;
    if (cursor.lineBreak && buffer.length >= WORD_COUNT_BUFFER_LIMIT) {
      flush();
    }
  }
  flush();
  return count;
}

/** Count sentences using Intl.Segmenter, ignoring whitespace-only segments. */
function countSentences(text: string): number {
  let count = 0;
  for (const { segment } of sentenceSegmenter.segment(text)) {
    if (segment.trim().length > 0) count++;
  }
  return count;
}

/** Strip frontmatter and return the document body. */
function getBody(text: string): string {
  const { end } = parseFrontmatter(text);
  return end >= 0 ? text.slice(end) : text;
}

function isFrontmatterDelimiterLine(text: string): boolean {
  return text.slice(0, 3) === "---" && text.slice(3).trim().length === 0;
}

function getTextBodyStart(doc: Text): number {
  const firstLine = doc.line(1);
  if (!isFrontmatterDelimiterLine(firstLine.text) || doc.lines < 2) {
    return 0;
  }

  for (let lineNumber = 2; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber);
    if (!isFrontmatterDelimiterLine(line.text)) {
      continue;
    }
    return line.number < doc.lines ? line.to + 1 : line.to;
  }

  return 0;
}

/**
 * Cheap live counters for the status-bar hot path.
 *
 * Skips sentence segmentation and derived stats — only word count (via
 * Intl.Segmenter word pass) and character count (body.length) are computed.
 */
export function computeLiveStats(text: string): { words: number; chars: number } {
  const body = getBody(text);
  return { words: countWords(body), chars: body.length };
}

export function computeLiveStatsFromText(doc: Text): { words: number; chars: number } {
  const bodyStart = getTextBodyStart(doc);
  return {
    words: countWordsInTextRange(doc, bodyStart),
    chars: doc.length - bodyStart,
  };
}

/** Compute full document statistics from raw markdown text. */
export function computeDocStats(text: string): DocStats {
  const body = getBody(text);

  const words = countWords(body);

  // Character counts
  const chars = body.length;
  const charsNoSpaces = body.replace(/\s/g, "").length;

  const sentences = words === 0 ? 0 : countSentences(body);

  // Reading time, minimum 1 min when there are words
  const readingMinutes = words === 0 ? 0 : Math.max(1, Math.ceil(words / READING_WPM));

  return { words, chars, charsNoSpaces, sentences, readingMinutes };
}
