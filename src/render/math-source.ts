import type { SelectionRange } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import type { EquationSemantics, MathSemantics } from "../semantics/document";

export const MATH_TYPES = new Set(["InlineMath", "DisplayMath"]);

interface MathDelimiterPair {
  readonly open: string;
  readonly close: string;
}

/** Delimiter patterns for extracting LaTeX content from inline math nodes. */
export const INLINE_DELIMITERS: ReadonlyArray<MathDelimiterPair> = [
  { open: "\\(", close: "\\)" },
  { open: "$", close: "$" },
];

/** Delimiter patterns for extracting LaTeX content from display math nodes. */
export const DISPLAY_DELIMITERS: ReadonlyArray<MathDelimiterPair> = [
  { open: "\\[", close: "\\]" },
  { open: "$$", close: "$$" },
];

/**
 * Compute the relative content boundary for a display math node that may
 * contain an EquationLabel child. Returns `undefined` when there is no label.
 */
export function getDisplayMathContentEnd(node: SyntaxNode): number | undefined {
  if (!node.getChild("EquationLabel")) return undefined;
  const marks = node.getChildren("DisplayMathMark");
  if (marks.length >= 2) {
    return marks[marks.length - 1].to - node.from;
  }
  return undefined;
}

/**
 * Strip math delimiters from raw source.
 * `contentTo` slices raw to the end of the closing delimiter, excluding labels.
 */
export function stripMathDelimiters(raw: string, isDisplay: boolean, contentTo?: number): string {
  const trimmed = contentTo !== undefined ? raw.slice(0, contentTo) : raw;
  const delimiters = isDisplay ? DISPLAY_DELIMITERS : INLINE_DELIMITERS;
  for (const { open, close } of delimiters) {
    if (trimmed.startsWith(open) && trimmed.endsWith(close)) {
      return trimmed.slice(open.length, trimmed.length - close.length);
    }
  }
  return trimmed;
}

/**
 * Snap an absolute document position to the nearest LaTeX token boundary
 * so the cursor doesn't land mid-command (for example inside `\alpha`).
 */
export function _snapToTokenBoundary(
  latex: string,
  contentFrom: number,
  absPos: number,
): number {
  const rel = absPos - contentFrom;
  const starts: number[] = [];
  let i = 0;
  while (i < latex.length) {
    starts.push(i);
    if (latex[i] === "\\") {
      i++;
      if (i < latex.length && /[a-zA-Z]/.test(latex[i])) {
        while (i < latex.length && /[a-zA-Z]/.test(latex[i])) i++;
      } else if (i < latex.length) {
        i++;
      }
    } else {
      i++;
    }
  }
  starts.push(latex.length);

  let best = starts[0];
  let bestDist = Math.abs(rel - best);
  for (let j = 1; j < starts.length; j++) {
    const dist = Math.abs(rel - starts[j]);
    if (dist < bestDist) {
      best = starts[j];
      bestDist = dist;
    } else {
      break;
    }
  }
  return contentFrom + best;
}

function findMathRegionCandidate(
  regions: readonly MathSemantics[],
  pos: number,
): MathSemantics | undefined {
  let lo = 0;
  let hi = regions.length - 1;
  let candidate: MathSemantics | undefined;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const region = regions[mid];
    if (region.from <= pos) {
      candidate = region;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return candidate;
}

export function findMathRegionAtPos(
  regions: readonly MathSemantics[],
  pos: number,
): MathSemantics | undefined {
  const candidate = findMathRegionCandidate(regions, pos);
  return candidate && pos <= candidate.to ? candidate : undefined;
}

/**
 * Binary-search the sorted math regions for the one containing the selection.
 */
export function findActiveMath(
  regions: readonly MathSemantics[],
  selection: SelectionRange,
): MathSemantics | undefined {
  const candidate = findMathRegionCandidate(regions, selection.from);
  return candidate && selection.to <= candidate.to ? candidate : undefined;
}

function buildEquationNumbers(
  equationById: ReadonlyMap<string, EquationSemantics>,
): ReadonlyMap<number, number> {
  const numbers = new Map<number, number>();
  for (const equation of equationById.values()) {
    numbers.set(equation.from, equation.number);
  }
  return numbers;
}

const equationNumbersByFromCache = new WeakMap<
  ReadonlyMap<string, EquationSemantics>,
  ReadonlyMap<number, number>
>();

export function buildEquationNumbersByFrom(
  equationById: ReadonlyMap<string, EquationSemantics>,
): ReadonlyMap<number, number> {
  const cached = equationNumbersByFromCache.get(equationById);
  if (cached) return cached;

  const numbers = buildEquationNumbers(equationById);
  equationNumbersByFromCache.set(equationById, numbers);
  return numbers;
}

export function getDisplayEquationNumber(
  region: MathSemantics,
  equationNumbersByFrom: ReadonlyMap<number, number>,
): number | undefined {
  if (!region.isDisplay || region.labelFrom === undefined) return undefined;
  return equationNumbersByFrom.get(region.from);
}
