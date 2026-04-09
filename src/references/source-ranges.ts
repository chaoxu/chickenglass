import { isIdentChar, isSpaceTab } from "../parser/char-utils";
import { readBracedLabelId } from "../parser/label-utils";
import { findTrailingHeadingAttributes } from "../semantics/heading-attributes";

export interface TokenSpan {
  readonly tokenFrom: number;
  readonly tokenTo: number;
  readonly labelFrom: number;
  readonly labelTo: number;
}

function isValidTokenBoundary(text: string, pos: number): boolean {
  return pos >= text.length || !isIdentChar(text.charCodeAt(pos));
}

export function findBracketedOccurrenceSpan(
  raw: string,
  rawFrom: number,
  id: string,
  searchFrom: number,
): TokenSpan | null {
  const token = `@${id}`;
  const tokenIndex = raw.indexOf(token, searchFrom);
  if (tokenIndex < 0) return null;
  const tokenEnd = tokenIndex + token.length;
  if (!isValidTokenBoundary(raw, tokenEnd)) {
    return findBracketedOccurrenceSpan(raw, rawFrom, id, tokenIndex + 1);
  }

  return {
    tokenFrom: rawFrom + tokenIndex,
    tokenTo: rawFrom + tokenEnd,
    labelFrom: rawFrom + tokenIndex + 1,
    labelTo: rawFrom + tokenEnd,
  };
}

function skipSpaces(text: string, pos: number): number {
  while (pos < text.length && isSpaceTab(text.charCodeAt(pos))) {
    pos += 1;
  }
  return pos;
}

function readIdentifierEnd(text: string, pos: number): number {
  while (pos < text.length && isIdentChar(text.charCodeAt(pos))) {
    pos += 1;
  }
  return pos;
}

function skipAttributeValue(text: string, pos: number): number {
  if (pos >= text.length) return pos;
  if (text[pos] === "\"") {
    pos += 1;
    while (pos < text.length && text[pos] !== "\"") {
      pos += 1;
    }
    return pos < text.length ? pos + 1 : pos;
  }

  while (
    pos < text.length &&
    !isSpaceTab(text.charCodeAt(pos)) &&
    text[pos] !== "}"
  ) {
    pos += 1;
  }
  return pos;
}

export function findAttributeIdSpan(
  attrText: string,
  absoluteFrom: number,
  expectedId: string,
): TokenSpan | undefined {
  const trimmedFrom = skipSpaces(attrText, 0);
  const text = attrText.slice(trimmedFrom);
  if (!text.startsWith("{") || !text.endsWith("}")) return undefined;

  let pos = 1;
  while (pos < text.length - 1) {
    pos = skipSpaces(text, pos);
    if (pos >= text.length - 1) break;

    if (text[pos] === ".") {
      const next = readIdentifierEnd(text, pos + 1);
      if (next === pos + 1) return undefined;
      pos = next;
      continue;
    }

    if (text[pos] === "#") {
      const tokenStart = pos;
      const labelStart = pos + 1;
      const labelEnd = readIdentifierEnd(text, labelStart);
      if (labelEnd === labelStart) return undefined;
      if (text.slice(labelStart, labelEnd) === expectedId) {
        return {
          tokenFrom: absoluteFrom + trimmedFrom + tokenStart,
          tokenTo: absoluteFrom + trimmedFrom + labelEnd,
          labelFrom: absoluteFrom + trimmedFrom + labelStart,
          labelTo: absoluteFrom + trimmedFrom + labelEnd,
        };
      }
      pos = labelEnd;
      continue;
    }

    const keyEnd = readIdentifierEnd(text, pos);
    if (keyEnd === pos || keyEnd >= text.length || text[keyEnd] !== "=") {
      return undefined;
    }
    pos = skipAttributeValue(text, keyEnd + 1);
  }

  return undefined;
}

export function findEquationLabelSpan(
  labelText: string,
  absoluteFrom: number,
  expectedId: string,
): TokenSpan | undefined {
  if (readBracedLabelId(labelText, 0, labelText.length) !== expectedId) {
    return undefined;
  }

  return {
    tokenFrom: absoluteFrom,
    tokenTo: absoluteFrom + labelText.length,
    labelFrom: absoluteFrom + 2,
    labelTo: absoluteFrom + 2 + expectedId.length,
  };
}

function findHeadingContentOffset(rawHeading: string): number {
  let pos = 0;
  while (pos < rawHeading.length && rawHeading[pos] === "#") {
    pos += 1;
  }
  while (pos < rawHeading.length && isSpaceTab(rawHeading.charCodeAt(pos))) {
    pos += 1;
  }
  return pos;
}

export function findHeadingIdSpan(
  rawHeading: string,
  absoluteFrom: number,
  expectedId: string,
): TokenSpan | undefined {
  const contentOffset = findHeadingContentOffset(rawHeading);
  const content = rawHeading.slice(contentOffset);
  const attrs = findTrailingHeadingAttributes(content);
  if (!attrs) return undefined;

  const rawStart = skipSpaces(attrs.raw, 0);
  const attrOffset = contentOffset + attrs.index + rawStart;
  const attrText = attrs.raw.slice(rawStart);
  return findAttributeIdSpan(attrText, absoluteFrom + attrOffset, expectedId);
}
