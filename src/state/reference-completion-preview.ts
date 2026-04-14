import type { CslJsonItem } from "../citations/bibtex-parser";
import { formatCitationPreview } from "../lexical/markdown/reference-display";
import type { ReferenceRenderDependencies } from "./reference-render-state";

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
