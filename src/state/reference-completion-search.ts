import type { ReferenceCompletionCandidate } from "./reference-completion-preview";

const COMPLETE_REF_PART_RE = /^\s*@[A-Za-z0-9_][\w:./'-]*(?:\s*,.*)?\s*$/;
const ACTIVE_REF_PART_RE = /^(\s*@)([\w:./'-]*)$/;
const NARRATIVE_REF_RE = /(?:^|[^\w@])@([\w:./'-]*)$/;

export interface ReferenceCompletionMatch {
  readonly kind: "bracketed" | "narrative";
  readonly leadOffset: number;
  readonly matchingString: string;
  readonly replaceableString: string;
}

export function applyBracketedReferenceCompletion(raw: string, nextId: string): string {
  if (!raw.startsWith("[")) {
    return `[@${nextId}`;
  }

  const body = raw.slice(1);
  const parts = body.split(";");
  const activePart = parts.pop() ?? "";
  const prefix = parts.length > 0 ? `${parts.join(";")};` : "";
  const activeMatch = ACTIVE_REF_PART_RE.exec(activePart);
  if (!activeMatch) {
    return raw;
  }

  return `[${prefix}${activeMatch[1]}${nextId}`;
}

function findBracketedReferenceCompletionMatch(text: string): ReferenceCompletionMatch | null {
  const openBracket = text.lastIndexOf("[");
  if (openBracket < 0 || openBracket < text.lastIndexOf("]")) {
    return null;
  }

  const clusterText = text.slice(openBracket);
  const contentBefore = clusterText.slice(1);
  if (!contentBefore.trimStart().startsWith("@")) {
    return null;
  }

  const parts = contentBefore.split(";");
  const activePart = parts[parts.length - 1] ?? "";
  const stableParts = parts.slice(0, -1);
  if (stableParts.some((part) => !COMPLETE_REF_PART_RE.test(part))) {
    return null;
  }

  if (activePart.includes(",")) {
    return null;
  }

  const activeMatch = ACTIVE_REF_PART_RE.exec(activePart);
  if (!activeMatch) {
    return null;
  }

  return {
    kind: "bracketed",
    leadOffset: openBracket,
    matchingString: activeMatch[2] ?? "",
    replaceableString: clusterText,
  };
}

function findNarrativeReferenceCompletionMatch(text: string): ReferenceCompletionMatch | null {
  const match = NARRATIVE_REF_RE.exec(text);
  if (!match || match.index === undefined) {
    return null;
  }

  const fullMatch = match[0];
  const atIndex = text.length - fullMatch.length + fullMatch.lastIndexOf("@");
  return {
    kind: "narrative",
    leadOffset: atIndex,
    matchingString: match[1] ?? "",
    replaceableString: text.slice(atIndex),
  };
}

export function findReferenceCompletionMatch(text: string): ReferenceCompletionMatch | null {
  return (
    findBracketedReferenceCompletionMatch(text)
    ?? findNarrativeReferenceCompletionMatch(text)
  );
}

function candidatePreviewSearchText(candidate: ReferenceCompletionCandidate): string {
  switch (candidate.previewSource.kind) {
    case "citation":
    case "heading":
      return candidate.previewSource.text ?? "";
    case "block":
    case "equation":
      return "";
  }
}

function candidateSearchText(candidate: ReferenceCompletionCandidate): string {
  return [
    candidate.id,
    candidate.label,
    candidate.detail ?? "",
    candidatePreviewSearchText(candidate),
  ].join("\n").toLowerCase();
}

function candidateKindRank(kind: ReferenceCompletionCandidate["kind"]): number {
  switch (kind) {
    case "block":
      return 0;
    case "equation":
      return 1;
    case "heading":
      return 2;
    case "citation":
      return 3;
  }
}

function candidateQueryRank(candidate: ReferenceCompletionCandidate, query: string): number {
  if (!query) {
    return 0;
  }

  const normalizedQuery = query.toLowerCase();
  const id = candidate.id.toLowerCase();
  const label = candidate.label.toLowerCase();
  if (id === normalizedQuery) {
    return 0;
  }
  if (id.startsWith(normalizedQuery)) {
    return 1;
  }
  if (label.startsWith(normalizedQuery)) {
    return 2;
  }
  if (candidateSearchText(candidate).includes(normalizedQuery)) {
    return 3;
  }
  return Number.POSITIVE_INFINITY;
}

export function filterReferenceCompletionCandidates(
  candidates: readonly ReferenceCompletionCandidate[],
  query: string,
): ReferenceCompletionCandidate[] {
  const normalizedQuery = query.trim().toLowerCase();
  return candidates
    .filter((candidate) =>
      !normalizedQuery || candidateSearchText(candidate).includes(normalizedQuery))
    .sort((left, right) => {
      const queryRank = candidateQueryRank(left, normalizedQuery) - candidateQueryRank(right, normalizedQuery);
      if (queryRank !== 0) {
        return queryRank;
      }

      const kindRank = candidateKindRank(left.kind) - candidateKindRank(right.kind);
      if (kindRank !== 0) {
        return kindRank;
      }

      return left.id.localeCompare(right.id);
    });
}
