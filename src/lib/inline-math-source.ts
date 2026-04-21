import {
  isBackslashEscaped,
  isPandocDollarMathCloser,
  isPandocDollarMathOpener,
} from "./pandoc-dollar-math";

export type InlineMathDelimiter = "dollar" | "paren";

export interface ParsedInlineMathSource {
  readonly body: string;
  readonly bodyFrom: number;
  readonly bodyTo: number;
  readonly delimiter: InlineMathDelimiter;
  readonly from: number;
  readonly raw: string;
  readonly to: number;
}

export const INLINE_MATH_DOLLAR_IMPORT_RE =
  /(?<!\\)\$(?![\s$])(?:[^$\n\\]|\\.)*(?<!\s)\$(?!\d)/;
export const INLINE_MATH_DOLLAR_SHORTCUT_RE =
  /(?<!\\)\$(?![\s$])(?:[^$\n\\]|\\.)*(?<!\s)\$(?!\d)$/;
export const INLINE_MATH_PAREN_IMPORT_RE = /\\\((?:[^\\\n]|\\.)+\\\)/;
export const INLINE_MATH_PAREN_SHORTCUT_RE = /\\\((?:[^\\\n]|\\.)+\\\)$/;

const INLINE_MATH_PAREN_EXACT_RE = /^\\\(((?:[^\\\n]|\\.)+)\\\)$/;

function charCodeAt(text: string, index: number): number {
  return index >= 0 && index < text.length ? text.charCodeAt(index) : -1;
}

function parseDollarInlineMathSource(
  raw: string,
  from: number,
): ParsedInlineMathSource | null {
  if (raw[0] !== "$") {
    return null;
  }
  if (!isPandocDollarMathOpener(charCodeAt(raw, 1))) {
    return null;
  }

  const close = findClosingDollar(raw, 1);
  if (close !== raw.length - 1) {
    return null;
  }

  const body = raw.slice(1, -1);
  return {
    body,
    bodyFrom: from + 1,
    bodyTo: from + raw.length - 1,
    delimiter: "dollar",
    from,
    raw,
    to: from + raw.length,
  };
}

export function parseInlineMathSource(
  raw: string,
  from = 0,
): ParsedInlineMathSource | null {
  const dollar = parseDollarInlineMathSource(raw, from);
  if (dollar) return dollar;

  const paren = raw.match(INLINE_MATH_PAREN_EXACT_RE);
  if (paren?.[1] && paren[1].trim().length > 0) {
    return {
      body: paren[1],
      bodyFrom: from + 2,
      bodyTo: from + raw.length - 2,
      delimiter: "paren",
      from,
      raw,
      to: from + raw.length,
    };
  }

  return null;
}

function findClosingDollar(text: string, start: number): number {
  let index = start;
  while (index < text.length) {
    if (text[index] === "\\" && index + 1 < text.length) {
      index += 2;
      continue;
    }
    if (
      text[index] === "$"
      && !isBackslashEscaped(text, index)
      && isPandocDollarMathCloser(
        charCodeAt(text, index - 1),
        charCodeAt(text, index + 1),
      )
    ) {
      return index;
    }
    index += 1;
  }
  return -1;
}

export function findNextInlineMathSource(
  text: string,
  start = 0,
  options: { readonly requireTightDollar?: boolean } = {},
): ParsedInlineMathSource | null {
  for (let index = start; index < text.length; index += 1) {
    if (text.startsWith("\\(", index)) {
      const close = text.indexOf("\\)", index + 2);
      if (close >= 0) {
        const raw = text.slice(index, close + 2);
        const parsed = parseInlineMathSource(raw, index);
        if (parsed) return parsed;
      }
    }

    if (
      text[index] !== "$"
      || isBackslashEscaped(text, index)
      || !isPandocDollarMathOpener(charCodeAt(text, index + 1))
    ) {
      continue;
    }

    const close = findClosingDollar(text, index + 1);
    if (close < 0) {
      continue;
    }
    const raw = text.slice(index, close + 1);
    const parsed = parseInlineMathSource(raw, index);
    if (!parsed) {
      continue;
    }
    if (
      options.requireTightDollar
      && parsed.delimiter === "dollar"
      && (/\s/.test(parsed.body[0] ?? "") || /\s/.test(parsed.body.at(-1) ?? ""))
    ) {
      continue;
    }
    return parsed;
  }

  return null;
}

export function stripInlineMathDelimiters(raw: string): string {
  return parseInlineMathSource(raw)?.body ?? raw;
}
