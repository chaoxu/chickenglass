export interface ReferenceClusterParts {
  readonly ids: readonly string[];
  readonly locators: readonly (string | undefined)[];
}

export interface BracketedReferenceMatch extends ReferenceClusterParts {
  readonly raw: string;
}

export const BRACKETED_REFERENCE_RE =
  /^\[@([a-zA-Z0-9_][\w:./''-]*(?:,[^;\]]*)?(?:\s*;\s*@[a-zA-Z0-9_][\w:./''-]*(?:,[^;\]]*)?)*)\]$/;

export const NARRATIVE_REFERENCE_RE = /(?<![[@\w])@([a-zA-Z0-9_][\w:./''-]*\w)/g;

export function extractReferenceCluster(raw: string): ReferenceClusterParts {
  const ids: string[] = [];
  const locators: (string | undefined)[] = [];

  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    const key = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
    const commaIdx = key.indexOf(",");
    if (commaIdx >= 0) {
      ids.push(key.slice(0, commaIdx).trim());
      const locator = key.slice(commaIdx + 1).trim();
      locators.push(locator || undefined);
    } else {
      ids.push(key.trim());
      locators.push(undefined);
    }
  }

  return { ids, locators };
}

export function matchBracketedReference(raw: string): BracketedReferenceMatch | null {
  const match = BRACKETED_REFERENCE_RE.exec(raw);
  if (!match) return null;
  return {
    raw: match[1],
    ...extractReferenceCluster(match[1]),
  };
}
