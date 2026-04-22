import {
  BRACKETED_REFERENCE_EXACT_RE,
  extractReferenceCluster,
  NARRATIVE_REFERENCE_GLOBAL_RE,
  type ReferenceClusterParts,
} from "../lib/reference-grammar";

export type { ReferenceClusterParts };

export interface BracketedReferenceMatch extends ReferenceClusterParts {
  readonly raw: string;
}

export const BRACKETED_REFERENCE_RE = BRACKETED_REFERENCE_EXACT_RE;

export const NARRATIVE_REFERENCE_RE = NARRATIVE_REFERENCE_GLOBAL_RE;
export { extractReferenceCluster };

export function matchBracketedReference(raw: string): BracketedReferenceMatch | null {
  const match = BRACKETED_REFERENCE_RE.exec(raw);
  if (!match) return null;
  return {
    raw: match[1],
    ...extractReferenceCluster(match[1]),
  };
}
