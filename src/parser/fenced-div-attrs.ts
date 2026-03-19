/**
 * Parser for fenced div attribute strings like `{.theorem #my-thm key=value}`.
 *
 * Attributes follow Pandoc's fenced div syntax:
 * - `.name` adds a class
 * - `#name` adds an id
 * - `key=value` or `key="value"` adds a key-value pair
 */

import { isSpaceTab } from "./char-utils";

/** Parsed result of a fenced div attribute string. */
export interface FencedDivAttrs {
  readonly classes: readonly string[];
  readonly id: string | undefined;
  readonly keyValues: Readonly<Record<string, string>>;
}

/**
 * Parse an attribute string like `{.theorem #my-thm key=value}`.
 *
 * The input should include the surrounding braces. Returns `undefined`
 * if the string is not a valid attribute block.
 */
export function parseFencedDivAttrs(input: string): FencedDivAttrs | undefined {
  const trimmed = input.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return undefined;

  const inner = trimmed.slice(1, -1).trim();
  if (inner.length === 0) return undefined;

  const classes: string[] = [];
  let id: string | undefined;
  const keyValues: Record<string, string> = {};

  let pos = 0;
  while (pos < inner.length) {
    // Skip whitespace
    while (pos < inner.length && isSpaceTab(inner.charCodeAt(pos))) pos++;
    if (pos >= inner.length) break;

    const ch = inner[pos];
    if (ch === ".") {
      // Class: .name
      pos++;
      const name = readIdentifier(inner, pos);
      if (name.length === 0) return undefined;
      classes.push(name);
      pos += name.length;
    } else if (ch === "#") {
      // ID: #name
      pos++;
      const name = readIdentifier(inner, pos);
      if (name.length === 0) return undefined;
      id = name;
      pos += name.length;
    } else {
      // Key=value pair
      const key = readIdentifier(inner, pos);
      if (key.length === 0) return undefined;
      pos += key.length;
      if (pos >= inner.length || inner[pos] !== "=") return undefined;
      pos++; // skip '='
      const result = readValue(inner, pos);
      if (result === undefined) return undefined;
      keyValues[key] = result.value;
      pos = result.end;
    }
  }

  return { classes, id, keyValues };
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
  return {
    classes: [trimmed.toLowerCase()],
    id: undefined,
    keyValues: {},
  };
}

/** Characters allowed in identifiers: letters, digits, hyphens, underscores, colons, periods. */
function isIdentChar(ch: number): boolean {
  return (
    (ch >= 65 && ch <= 90) ||   // A-Z
    (ch >= 97 && ch <= 122) ||  // a-z
    (ch >= 48 && ch <= 57) ||   // 0-9
    ch === 45 ||                // -
    ch === 95 ||                // _
    ch === 58 ||                // :
    ch === 46                   // .
  );
}


/** Read an identifier starting at `pos`. */
function readIdentifier(str: string, pos: number): string {
  const start = pos;
  while (pos < str.length && isIdentChar(str.charCodeAt(pos))) pos++;
  return str.slice(start, pos);
}

/** Read a value (plain or quoted) starting at `pos`. */
function readValue(
  str: string,
  pos: number,
): { value: string; end: number } | undefined {
  if (pos >= str.length) return undefined;

  if (str[pos] === '"') {
    // Quoted value
    pos++; // skip opening quote
    const start = pos;
    while (pos < str.length && str[pos] !== '"') pos++;
    if (pos >= str.length) return undefined; // unterminated quote
    const value = str.slice(start, pos);
    pos++; // skip closing quote
    return { value, end: pos };
  }

  // Unquoted value: read until whitespace or end
  const start = pos;
  while (pos < str.length && !isSpaceTab(str.charCodeAt(pos))) pos++;
  if (pos === start) return undefined;
  return { value: str.slice(start, pos), end: pos };
}
