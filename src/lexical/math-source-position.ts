import { parseInlineMathSource } from "./inline-math-source";

function textNodeParent(target: EventTarget | null): Element | null {
  if (target instanceof Element) {
    return target;
  }
  if (target instanceof Text) {
    return target.parentElement;
  }
  return null;
}

function numericDataAttr(element: HTMLElement, name: string): number | null {
  const value = element.dataset[name];
  if (value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sourceLocationFromKatexTarget(
  target: EventTarget | null,
  clientX: number | undefined,
): number | null {
  const element = textNodeParent(target);
  const located = element?.closest<HTMLElement>("[data-loc-start][data-loc-end]");
  if (!located) {
    return null;
  }

  const start = numericDataAttr(located, "locStart");
  const end = numericDataAttr(located, "locEnd");
  if (start === null || end === null) {
    return null;
  }

  if (clientX === undefined || end <= start) {
    return start;
  }

  const rect = located.getBoundingClientRect();
  if (rect.width <= 0) {
    return start;
  }

  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  return Math.round(start + (end - start) * ratio);
}

function fallbackBodyLocationFromMathRoot(
  target: EventTarget | null,
  clientX: number | undefined,
  bodyLength: number,
  selector: string,
): number | null {
  const element = textNodeParent(target);
  const root = element?.closest<HTMLElement>(selector);
  if (!root) {
    return null;
  }
  if (clientX === undefined || bodyLength <= 0) {
    return 0;
  }

  const rect = root.getBoundingClientRect();
  if (rect.width <= 0) {
    return 0;
  }

  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  return Math.round(bodyLength * ratio);
}

export function inlineMathBodyStartOffset(raw: string): number {
  return parseInlineMathSource(raw)?.bodyFrom ?? 0;
}

export function inlineMathBodyEndOffset(raw: string): number {
  return parseInlineMathSource(raw)?.bodyTo ?? raw.length;
}

export function inlineMathSourceOffsetFromTarget(
  target: EventTarget | null,
  raw: string,
  clientX?: number,
): number | null {
  const bodyStart = inlineMathBodyStartOffset(raw);
  const bodyEnd = inlineMathBodyEndOffset(raw);
  const bodyLength = Math.max(0, bodyEnd - bodyStart);
  const located = sourceLocationFromKatexTarget(target, clientX);
  if (located !== null) {
    return Math.max(bodyStart, Math.min(bodyEnd, bodyStart + located));
  }

  const fallback = fallbackBodyLocationFromMathRoot(
    target,
    clientX,
    bodyLength,
    ".cf-lexical-inline-math",
  );
  return fallback === null ? null : Math.max(bodyStart, Math.min(bodyEnd, bodyStart + fallback));
}

export function displayMathBodyStartOffset(raw: string): number {
  const firstNewline = raw.indexOf("\n");
  const firstLine = firstNewline >= 0 ? raw.slice(0, firstNewline) : raw;
  if (/^\s*\\begin\{equation\*?\}(?:\s*\\label\{[A-Za-z][\w.:-]*\})?\s*$/.test(firstLine)) {
    return firstNewline >= 0 ? firstNewline + 1 : raw.length;
  }
  if (firstNewline >= 0) {
    return firstNewline + 1;
  }
  if (raw.trimStart().startsWith("\\[")) {
    return raw.indexOf("\\[") + 2;
  }
  return raw.indexOf("$$") + 2;
}

export function displayMathBodyEndOffset(raw: string): number {
  const equationEnd = raw.search(/\n\s*\\end\{equation\*?\}\s*$/);
  if (equationEnd >= 0) {
    return equationEnd;
  }
  const lastNewline = raw.lastIndexOf("\n");
  if (lastNewline > displayMathBodyStartOffset(raw)) {
    return lastNewline;
  }
  const closingBracket = raw.lastIndexOf("\\]");
  if (closingBracket > 0) {
    return closingBracket;
  }
  const closingDollar = raw.lastIndexOf("$$");
  if (closingDollar > 0) {
    return closingDollar;
  }
  return raw.length;
}

export function displayMathSourceOffsetFromTarget(
  target: EventTarget | null,
  raw: string,
  clientX?: number,
): number | null {
  const bodyStart = displayMathBodyStartOffset(raw);
  const bodyEnd = displayMathBodyEndOffset(raw);
  const bodyLength = Math.max(0, bodyEnd - bodyStart);
  const located = sourceLocationFromKatexTarget(target, clientX);
  if (located !== null) {
    return Math.max(bodyStart, Math.min(bodyEnd, bodyStart + located));
  }

  const fallback = fallbackBodyLocationFromMathRoot(
    target,
    clientX,
    bodyLength,
    ".cf-lexical-display-math-body",
  );
  return fallback === null ? null : Math.max(bodyStart, Math.min(bodyEnd, bodyStart + fallback));
}
