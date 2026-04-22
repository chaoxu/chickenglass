/**
 * Parser for fenced div attribute strings like `{.theorem #my-thm key=value}`.
 *
 * Attributes follow Pandoc's fenced div syntax:
 * - `.name` adds a class
 * - `#name` adds an id
 * - `key=value` or `key="value"` adds a key-value pair
 */

import { isSpaceTab, isIdentChar } from "./char-utils";

/** Parsed result of a fenced div attribute string. */
export interface FencedDivAttrs {
  readonly classes: readonly string[];
  readonly id: string | undefined;
  readonly keyValues: Readonly<Record<string, string>>;
  readonly keyValueRanges: Readonly<Record<string, FencedDivKeyValueRange>>;
}

/** Input-relative source range for a key-value attribute. */
export interface FencedDivKeyValueRange {
  readonly keyFrom: number;
  readonly keyTo: number;
  readonly valueFrom: number;
  readonly valueTo: number;
}

function createFencedDivAttrs(
  classes: readonly string[],
  id: string | undefined,
  keyValues: Readonly<Record<string, string>>,
  keyValueRanges: Readonly<Record<string, FencedDivKeyValueRange>>,
): FencedDivAttrs {
  const attrs = {
    classes,
    id,
    keyValues,
  } as FencedDivAttrs;
  Object.defineProperty(attrs, "keyValueRanges", {
    value: keyValueRanges,
    enumerable: false,
  });
  return attrs;
}

/**
 * Parse an attribute string like `{.theorem #my-thm key=value}`.
 *
 * The input should include the surrounding braces. Returns `undefined`
 * if the string is not a valid attribute block.
 */
export function parseFencedDivAttrs(input: string): FencedDivAttrs | undefined {
  const inputStart = skipSpace(input, 0);
  const inputEnd = trimEnd(input, inputStart);
  if (inputStart >= inputEnd) return undefined;
  if (input[inputStart] !== "{" || input[inputEnd - 1] !== "}") return undefined;

  const innerStart = inputStart + 1;
  const innerEnd = inputEnd - 1;
  if (skipSpace(input, innerStart) >= innerEnd) return undefined;

  const classes: string[] = [];
  let id: string | undefined;
  const keyValues: Record<string, string> = {};
  const keyValueRanges: Record<string, FencedDivKeyValueRange> = {};

  let pos = innerStart;
  while (pos < innerEnd) {
    // Skip whitespace
    pos = skipSpace(input, pos);
    if (pos >= innerEnd) break;

    const ch = input[pos];
    if (ch === ".") {
      // Class: .name
      pos++;
      const name = readIdentifier(input, pos, innerEnd);
      if (name.length === 0) return undefined;
      classes.push(name);
      pos += name.length;
    } else if (ch === "#") {
      // ID: #name
      pos++;
      const name = readIdentifier(input, pos, innerEnd);
      if (name.length === 0) return undefined;
      id = name;
      pos += name.length;
    } else {
      // Key=value pair
      const keyFrom = pos;
      const key = readIdentifier(input, pos, innerEnd);
      if (key.length === 0) return undefined;
      pos += key.length;
      const keyTo = pos;
      if (pos >= innerEnd || input[pos] !== "=") return undefined;
      pos++; // skip '='
      const result = readValue(input, pos, innerEnd);
      if (result === undefined) return undefined;
      keyValues[key] = result.value;
      keyValueRanges[key] = {
        keyFrom,
        keyTo,
        valueFrom: result.valueFrom,
        valueTo: result.valueTo,
      };
      pos = result.end;
    }
  }

  return createFencedDivAttrs(classes, id, keyValues, keyValueRanges);
}

/**
 * Extract the div class, id, and key-values from an attribute string.
 *
 * Handles two forms:
 * - Full attribute block: `{.theorem #thm-1 title="Main result"}`
 *   Uses `parseFencedDivAttrs` to parse.
 * - Bare class name (short-form): `Theorem`
 *   Lowercases the word and returns it as the single class.
 *
 * Returns `undefined` if the input is empty or invalid.
 */
export function extractDivClass(attrText: string): FencedDivAttrs | undefined {
  const trimmed = attrText.trim();
  if (trimmed.length === 0) return undefined;

  // Full attribute block with braces
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return parseFencedDivAttrs(trimmed);
  }

  // Bare class name (short-form): lowercase the word
  return createFencedDivAttrs([trimmed.toLowerCase()], undefined, {}, {});
}

/** Read an identifier starting at `pos`. */
function readIdentifier(str: string, pos: number, end = str.length): string {
  const start = pos;
  while (pos < end && isIdentChar(str.charCodeAt(pos))) pos++;
  return str.slice(start, pos);
}

function skipSpace(str: string, pos: number): number {
  while (pos < str.length && isSpaceTab(str.charCodeAt(pos))) pos++;
  return pos;
}

function trimEnd(str: string, min: number): number {
  let end = str.length;
  while (end > min && isSpaceTab(str.charCodeAt(end - 1))) end--;
  return end;
}

/** Read a value (plain or quoted) starting at `pos`. */
function readValue(
  str: string,
  pos: number,
  limit = str.length,
): { value: string; valueFrom: number; valueTo: number; end: number } | undefined {
  if (pos >= limit) return undefined;

  if (str[pos] === '"') {
    // Quoted value
    pos++; // skip opening quote
    const start = pos;
    while (pos < limit && str[pos] !== '"') pos++;
    if (pos >= limit) return undefined; // unterminated quote
    const value = str.slice(start, pos);
    const valueTo = pos;
    pos++; // skip closing quote
    return { value, valueFrom: start, valueTo, end: pos };
  }

  // Unquoted value: read until whitespace or end
  const start = pos;
  while (pos < limit && !isSpaceTab(str.charCodeAt(pos))) pos++;
  if (pos === start) return undefined;
  return { value: str.slice(start, pos), valueFrom: start, valueTo: pos, end: pos };
}
