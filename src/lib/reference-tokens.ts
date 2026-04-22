import {
  BRACKETED_REFERENCE_EXACT_RE,
  BRACKETED_REFERENCE_GLOBAL_RE,
  BRACKETED_REFERENCE_IMPORT_RE,
  BRACKETED_REFERENCE_SHORTCUT_RE,
  NARRATIVE_REFERENCE_EXACT_RE,
  NARRATIVE_REFERENCE_GLOBAL_RE,
  NARRATIVE_REFERENCE_IMPORT_RE,
  NARRATIVE_REFERENCE_SHORTCUT_RE,
  parseReferenceClusterBody,
} from "./reference-grammar";

const BRACKETED_REFERENCE_CANDIDATE_GLOBAL_RE = /\[(?:[^\]\n\\]|\\.)*?@[^\]\n]*\]/g;

export interface ReferenceToken {
  readonly bracketed: boolean;
  readonly clusterFrom: number;
  readonly clusterIndex: number;
  readonly clusterTo: number;
  readonly from: number;
  readonly id: string;
  readonly labelFrom: number;
  readonly labelTo: number;
  readonly locator?: string;
  readonly to: number;
}

export interface ParsedReferenceToken {
  readonly bracketed: boolean;
  readonly ids: readonly string[];
  readonly locators: readonly (string | undefined)[];
}

export interface ReferenceRevealToken {
  readonly bracketed: boolean;
  readonly from: number;
  readonly source: string;
  readonly to: number;
}

export {
  BRACKETED_REFERENCE_EXACT_RE,
  BRACKETED_REFERENCE_GLOBAL_RE,
  BRACKETED_REFERENCE_IMPORT_RE,
  BRACKETED_REFERENCE_SHORTCUT_RE,
  NARRATIVE_REFERENCE_EXACT_RE,
  NARRATIVE_REFERENCE_GLOBAL_RE,
  NARRATIVE_REFERENCE_IMPORT_RE,
  NARRATIVE_REFERENCE_SHORTCUT_RE,
};

export function scanReferenceTokens(text: string): ReferenceToken[] {
  const references: ReferenceToken[] = [];
  const coveredRanges: Array<{ from: number; to: number }> = [];

  for (const match of text.matchAll(BRACKETED_REFERENCE_CANDIDATE_GLOBAL_RE)) {
    const raw = match[0];
    const clusterFrom = match.index ?? 0;
    const clusterTo = clusterFrom + raw.length;
    const body = raw.slice(1, -1);
    const parts = BRACKETED_REFERENCE_EXACT_RE.test(raw)
      ? parseReferenceClusterBody(body)
      : null;

    if (parts) {
      for (const [clusterIndex, part] of parts.entries()) {
        const tokenFrom = clusterFrom + 1 + part.markerFrom;
        const tokenTo = clusterFrom + 1 + part.markerTo;
        references.push({
          bracketed: true,
          clusterFrom,
          clusterIndex,
          clusterTo,
          from: tokenFrom,
          id: part.id,
          labelFrom: tokenFrom + 1,
          labelTo: tokenTo,
          locator: part.locator,
          to: tokenTo,
        });
      }
    }

    coveredRanges.push({ from: clusterFrom, to: clusterTo });
  }

  outer: for (const match of text.matchAll(NARRATIVE_REFERENCE_GLOBAL_RE)) {
    const tokenFrom = match.index ?? 0;
    for (const covered of coveredRanges) {
      if (tokenFrom >= covered.from && tokenFrom < covered.to) {
        continue outer;
      }
    }

    const id = match[1] ?? "";
    if (!id) {
      continue;
    }
    const tokenTo = tokenFrom + 1 + id.length;
    references.push({
      bracketed: false,
      clusterFrom: tokenFrom,
      clusterIndex: 0,
      clusterTo: tokenTo,
      from: tokenFrom,
      id,
      labelFrom: tokenFrom + 1,
      labelTo: tokenTo,
      to: tokenTo,
    });
  }

  return references.sort((left, right) => left.from - right.from);
}

export function scanReferenceRevealTokens(text: string): ReferenceRevealToken[] {
  const reveals: ReferenceRevealToken[] = [];
  const seenBracketedClusters = new Set<string>();

  for (const token of scanReferenceTokens(text)) {
    if (token.bracketed) {
      const key = `${token.clusterFrom}:${token.clusterTo}`;
      if (seenBracketedClusters.has(key)) {
        continue;
      }
      seenBracketedClusters.add(key);
      reveals.push({
        bracketed: true,
        from: token.clusterFrom,
        source: text.slice(token.clusterFrom, token.clusterTo),
        to: token.clusterTo,
      });
      continue;
    }

    reveals.push({
      bracketed: false,
      from: token.from,
      source: text.slice(token.from, token.to),
      to: token.to,
    });
  }

  return reveals.sort((left, right) => left.from - right.from);
}

export function parseReferenceToken(raw: string): ParsedReferenceToken | null {
  const tokens = scanReferenceTokens(raw);
  if (BRACKETED_REFERENCE_EXACT_RE.test(raw)) {
    const bracketedTokens = tokens.filter((token) => token.bracketed);
    return bracketedTokens.length > 0
      ? {
          bracketed: true,
          ids: bracketedTokens.map((token) => token.id),
          locators: bracketedTokens.map((token) => token.locator),
        }
      : null;
  }

  if (NARRATIVE_REFERENCE_EXACT_RE.test(raw) && tokens.length === 1) {
    return {
      bracketed: false,
      ids: [tokens[0].id],
      locators: [undefined],
    };
  }

  return null;
}

export function isReferenceTokenSource(raw: string): boolean {
  return parseReferenceToken(raw) !== null;
}
