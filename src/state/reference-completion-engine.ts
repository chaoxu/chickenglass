import type { CslJsonItem } from "../citations/bibtex-parser";
import { formatCitationPreview } from "../lexical/markdown/reference-display";
import type { ReferenceRenderDependencies } from "./reference-render-state";

const COMPLETE_REF_PART_RE = /^\s*@[A-Za-z0-9_][\w:./'-]*(?:\s*,.*)?\s*$/;
const ACTIVE_REF_PART_RE = /^(\s*@)([\w:./'-]*)$/;
const NARRATIVE_REF_RE = /(?:^|[^\w@])@([\w:./'-]*)$/;

export interface ReferenceCompletionMatch {
  readonly kind: "bracketed" | "narrative";
  readonly leadOffset: number;
  readonly matchingString: string;
  readonly replaceableString: string;
}

export type ReferenceCompletionDependencies = Pick<
  ReferenceRenderDependencies,
  "citations" | "labelGraph" | "renderIndex"
>;

export type ReferenceCompletionPreviewSource =
  | {
    readonly kind: "block";
    readonly blockType?: string;
    readonly bodyMarkdown: string;
    readonly id: string;
    readonly title?: string;
  }
  | {
    readonly kind: "citation";
    readonly text?: string;
  }
  | {
    readonly kind: "equation";
    readonly id: string;
    readonly text: string;
  }
  | {
    readonly kind: "heading";
    readonly text?: string;
  };

export interface ReferenceCompletionCandidate {
  readonly detail?: string;
  readonly id: string;
  readonly kind: "block" | "citation" | "equation" | "heading";
  readonly label: string;
  readonly previewSource: ReferenceCompletionPreviewSource;
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

function formatCitationAuthor(item: CslJsonItem): string {
  const author = item.author?.[0];
  const base =
    author?.family
    ?? author?.literal
    ?? author?.given
    ?? item.publisher
    ?? item.id;

  return item.author && item.author.length > 1
    ? `${base} et al.`
    : base;
}

function formatCitationYear(item: CslJsonItem): string | undefined {
  const year = item.issued?.["date-parts"]?.[0]?.[0];
  return typeof year === "number" ? String(year) : undefined;
}

function formatCitationDetail(item: CslJsonItem): string {
  const author = formatCitationAuthor(item);
  const year = formatCitationYear(item);
  return year ? `${author} ${year}` : author;
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

export function collectReferenceCompletionCandidates(
  dependencies: ReferenceCompletionDependencies,
): ReferenceCompletionCandidate[] {
  const candidates = new Map<string, ReferenceCompletionCandidate>();

  for (const [id, definition] of dependencies.labelGraph.uniqueDefinitionById) {
    const referenceEntry = dependencies.renderIndex.references.get(id);
    if (definition.kind === "block" && definition.content != null) {
      candidates.set(id, {
        detail: id,
        id,
        kind: "block",
        label: definition.title?.trim() || referenceEntry?.label || id,
        previewSource: {
          bodyMarkdown: definition.content,
          blockType: definition.blockType,
          id: definition.id,
          kind: "block",
          title: definition.title,
        },
      });
      continue;
    }

    if (definition.kind === "equation" && definition.text) {
      candidates.set(id, {
        detail: id,
        id,
        kind: "equation",
        label: referenceEntry?.label || id,
        previewSource: {
          id: definition.id,
          kind: "equation",
          text: definition.text,
        },
      });
      continue;
    }

    if (definition.kind === "heading") {
      candidates.set(id, {
        detail: id,
        id,
        kind: "heading",
        label: definition.title?.trim() || referenceEntry?.label || id,
        previewSource: {
          kind: "heading",
          text: referenceEntry?.label,
        },
      });
    }
  }

  for (const item of dependencies.citations.store.values()) {
    if (candidates.has(item.id)) {
      continue;
    }

    const previewText = formatCitationPreview(item.id, dependencies.citations) ?? undefined;
    candidates.set(item.id, {
      detail: formatCitationDetail(item),
      id: item.id,
      kind: "citation",
      label: item.id,
      previewSource: {
        kind: "citation",
        text: previewText,
      },
    });
  }

  return [...candidates.values()];
}
