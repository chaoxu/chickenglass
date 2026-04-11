import type {
  FencedDivSemantics,
  IncludeSemantics,
  TextSource,
} from "../../document";
import {
  type PositionMapper,
} from "../merge-utils";
import type { RawChangedRange } from "../types";

function isSpaceTab(charCode: number): boolean {
  return charCode === 9 || charCode === 32;
}

function isTrimWhitespace(charCode: number): boolean {
  return charCode === 9 || charCode === 10 || charCode === 13 || charCode === 32;
}

function isClosingFenceLine(line: string): boolean {
  let cursor = 0;
  while (cursor < line.length && isSpaceTab(line.charCodeAt(cursor))) {
    cursor++;
  }

  let colonCount = 0;
  while (cursor < line.length && line.charCodeAt(cursor) === 58) {
    colonCount++;
    cursor++;
  }

  if (colonCount < 3) return false;

  while (cursor < line.length && isSpaceTab(line.charCodeAt(cursor))) {
    cursor++;
  }

  return cursor === line.length;
}

// CM6 window extraction can miss closeFenceFrom for an otherwise closed block.
// When that happens, strip a trailing close-fence line before treating the
// remaining body as the include path.
function trimImplicitCloseFence(bodyText: string): string {
  let end = bodyText.length;
  while (end > 0 && isTrimWhitespace(bodyText.charCodeAt(end - 1))) {
    end--;
  }

  if (end === 0) return bodyText;

  const lineStart = bodyText.lastIndexOf("\n", end - 1) + 1;
  const lastLine = bodyText.slice(lineStart, end);
  if (!isClosingFenceLine(lastLine)) return bodyText;

  return bodyText.slice(0, lineStart);
}

function extractIncludePath(
  doc: TextSource,
  div: FencedDivSemantics,
): string | undefined {
  if (div.primaryClass !== "include") return undefined;

  if (
    div.titleFrom !== undefined
    && div.titleTo !== undefined
    && div.titleFrom < div.titleTo
  ) {
    const path = doc.slice(div.titleFrom, div.titleTo).trim();
    if (path.length > 0) return path;
  }

  const bodyTo = div.closeFenceFrom >= 0 ? div.closeFenceFrom : div.to;
  if (div.openFenceTo < bodyTo) {
    const rawBody = doc.slice(div.openFenceTo, bodyTo);
    const body = div.closeFenceFrom >= 0 ? rawBody : trimImplicitCloseFence(rawBody);
    const path = body.trim();
    if (path.length > 0) return path;
  }

  return undefined;
}

function singleChangeShift(
  rawChangedRanges: readonly RawChangedRange[] | undefined,
): { readonly fromOld: number; readonly toOld: number; readonly delta: number } | null {
  if (!rawChangedRanges || rawChangedRanges.length !== 1) {
    return null;
  }

  const change = rawChangedRanges[0];
  const delta = (change.toNew - change.fromNew) - (change.toOld - change.fromOld);
  if (delta === 0) {
    return null;
  }

  return {
    fromOld: change.fromOld,
    toOld: change.toOld,
    delta,
  };
}

function mapIncludeSemantics(
  include: IncludeSemantics,
  changes: PositionMapper,
): IncludeSemantics {
  const from = changes.mapPos(include.from, 1);
  const to = Math.max(from, changes.mapPos(include.to, -1));
  if (from === include.from && to === include.to) {
    return include;
  }
  return {
    from,
    to,
    path: include.path,
  };
}

function shiftIncludeSemantics(
  include: IncludeSemantics,
  delta: number,
): IncludeSemantics {
  return {
    from: include.from + delta,
    to: include.to + delta,
    path: include.path,
  };
}

function mapPreviousIncludes(
  previous: readonly IncludeSemantics[],
  changes: PositionMapper,
  rawChangedRanges: readonly RawChangedRange[] | undefined,
): readonly IncludeSemantics[] {
  if (previous.length === 0) {
    return previous;
  }

  const shiftedChange = singleChangeShift(rawChangedRanges);
  const firstChanged = rawChangedRanges?.reduce(
    (min, range) => Math.min(min, range.fromOld),
    Number.POSITIVE_INFINITY,
  ) ?? Number.NEGATIVE_INFINITY;

  let startIndex = 0;
  while (startIndex < previous.length && previous[startIndex].to <= firstChanged) {
    startIndex += 1;
  }

  if (startIndex === previous.length) {
    return previous;
  }

  let changed = false;
  const mapped = startIndex === 0 ? [] : previous.slice(0, startIndex);
  for (let index = startIndex; index < previous.length; index += 1) {
    const include = previous[index];
    const next = shiftedChange && include.from >= shiftedChange.toOld
      ? shiftIncludeSemantics(include, shiftedChange.delta)
      : mapIncludeSemantics(include, changes);
    if (next !== include) {
      changed = true;
    }
    mapped.push(next);
  }

  return changed ? mapped : previous;
}

export function deriveIncludeSlice(
  doc: TextSource,
  fencedDivs: readonly FencedDivSemantics[],
  previous: readonly IncludeSemantics[] = [],
  changes?: PositionMapper,
  rawChangedRanges?: readonly RawChangedRange[],
): readonly IncludeSemantics[] {
  const mappedPrevious = changes
    ? mapPreviousIncludes(previous, changes, rawChangedRanges)
    : previous;
  const previousByFrom = new Map(mappedPrevious.map((include) => [include.from, include]));
  const includes: IncludeSemantics[] = [];

  for (const div of fencedDivs) {
    const path = extractIncludePath(doc, div);
    if (!path) continue;

    const candidate = previousByFrom.get(div.from);
    if (candidate && candidate.to === div.to && candidate.path === path) {
      includes.push(candidate);
      continue;
    }

    includes.push({
      from: div.from,
      to: div.to,
      path,
    });
  }

  return includes;
}
