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

export const BRACKETED_REFERENCE_GLOBAL_RE = /\[(?:[^\]\n\\]|\\.)*?@[^\]\n]*\]/g;
export const BRACKETED_REFERENCE_IMPORT_RE = /\[(?:[^\]\n\\]|\\.)*?@[^\]\n]*\]/;
export const BRACKETED_REFERENCE_SHORTCUT_RE = /\[(?:[^\]\n\\]|\\.)*?@[^\]\n]*\]$/;
export const BRACKETED_REFERENCE_EXACT_RE = /^\[(?:[^\]\n\\]|\\.)*?@[^\]\n]*\]$/;
export const NARRATIVE_REFERENCE_GLOBAL_RE = /(?<![\w@])@([A-Za-z0-9_](?:[\w.:-]*\w)?)(?![\w@])/g;
export const NARRATIVE_REFERENCE_IMPORT_RE = /(?<![\w@])@([A-Za-z0-9_](?:[\w.:-]*\w)?)(?![\w@])/;
export const NARRATIVE_REFERENCE_SHORTCUT_RE = /(?<![\w@])@([A-Za-z0-9_](?:[\w.:-]*\w)?)(?![\w@])$/;
export const NARRATIVE_REFERENCE_EXACT_RE = /^@[A-Za-z0-9_](?:[\w.:-]*\w)?$/;

function trimTrailingReferencePunctuation(id: string): string {
  return id.replace(/\.+$/, "");
}

function normalizeLocator(locator: string): string | undefined {
  return locator.replace(/^[\s;,:-]+|[\s;,:-]+$/g, "").replace(/\s+/g, " ").trim() || undefined;
}

export function scanReferenceTokens(text: string): ReferenceToken[] {
  const references: ReferenceToken[] = [];
  const coveredRanges: Array<{ from: number; to: number }> = [];

  for (const match of text.matchAll(BRACKETED_REFERENCE_GLOBAL_RE)) {
    const raw = match[0];
    const clusterFrom = match.index ?? 0;
    const clusterTo = clusterFrom + raw.length;
    const body = raw.slice(1, -1);
    let clusterIndex = 0;

    for (const refMatch of body.matchAll(NARRATIVE_REFERENCE_GLOBAL_RE)) {
      const id = trimTrailingReferencePunctuation(refMatch[1] ?? "");
      if (!id) {
        continue;
      }
      const relativeFrom = refMatch.index ?? 0;
      const tokenFrom = clusterFrom + 1 + relativeFrom;
      const tokenTo = tokenFrom + 1 + id.length;
      const nextRelativeFrom = relativeFrom + refMatch[0].length;
      const nextReference = body
        .slice(nextRelativeFrom)
        .search(NARRATIVE_REFERENCE_IMPORT_RE);
      const locatorSlice = nextReference >= 0
        ? body.slice(nextRelativeFrom, nextRelativeFrom + nextReference)
        : body.slice(nextRelativeFrom);

      references.push({
        bracketed: true,
        clusterFrom,
        clusterIndex,
        clusterTo,
        from: tokenFrom,
        id,
        labelFrom: tokenFrom + 1,
        labelTo: tokenTo,
        locator: normalizeLocator(locatorSlice),
        to: tokenTo,
      });
      clusterIndex += 1;
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

    const id = trimTrailingReferencePunctuation(match[1] ?? "");
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
