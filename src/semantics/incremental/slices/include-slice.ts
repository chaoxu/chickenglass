import type {
  FencedDivSemantics,
  IncludeSemantics,
  TextSource,
} from "../../document";
import {
  mapRangeObject,
  type PositionMapper,
} from "../merge-utils";

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
    const path = doc.slice(div.openFenceTo, bodyTo).trim();
    if (path.length > 0) return path;
  }

  return undefined;
}

export function deriveIncludeSlice(
  doc: TextSource,
  fencedDivs: readonly FencedDivSemantics[],
  previous: readonly IncludeSemantics[] = [],
  changes?: PositionMapper,
): readonly IncludeSemantics[] {
  const mappedPrevious = changes
    ? previous.map((include) => mapRangeObject(include, changes))
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
