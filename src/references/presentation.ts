import { StateField, type EditorState, type Transaction } from "@codemirror/state";
import type { CslJsonItem } from "../citations/bibtex-parser";
import { formatCitationPreview } from "../citations/citation-preview";
import {
  documentReferenceCatalogField,
  getEditorDocumentReferenceCatalog,
} from "../semantics/editor-reference-catalog";
import { getPreferredDocumentReferenceTarget } from "../semantics/reference-catalog";
import { type BibStore, bibDataField } from "../state/bib-data";

interface CachedCitationFormat {
  readonly display: string;
  readonly preview: string;
}

export interface ReferencePresentationModel {
  getDisplayText(id: string): string;
  getPreviewText(id: string): string | undefined;
}

let referencePresentationComputationCount = 0;

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

function formatCitationDisplay(item: CslJsonItem): string {
  const author = formatCitationAuthor(item);
  const year = formatCitationYear(item);
  return year ? `${author} ${year}` : author;
}

function getCachedCitationFormat(
  entries: Map<string, CachedCitationFormat>,
  store: BibStore | undefined,
  id: string,
): CachedCitationFormat | undefined {
  if (!store) {
    return undefined;
  }

  const entry = store.get(id);
  if (!entry) {
    return undefined;
  }

  const cached = entries.get(id);
  if (cached) {
    return cached;
  }

  referencePresentationComputationCount += 1;
  const next = {
    display: formatCitationDisplay(entry),
    preview: formatCitationPreview(entry),
  };
  entries.set(id, next);
  return next;
}

function createReferencePresentationModel(
  state: EditorState,
): ReferencePresentationModel {
  const store = state.field(bibDataField, false)?.store;
  const catalog = getEditorDocumentReferenceCatalog(state);
  const citationEntries = new Map<string, CachedCitationFormat>();

  return {
    getDisplayText(id) {
      const target = getPreferredDocumentReferenceTarget(catalog, id);
      if (target) {
        return target.displayLabel;
      }

      return getCachedCitationFormat(citationEntries, store, id)?.display ?? id;
    },

    getPreviewText(id) {
      return getCachedCitationFormat(citationEntries, store, id)?.preview;
    },
  };
}

function referencePresentationDependenciesChanged(tr: Transaction): boolean {
  return tr.docChanged
    || tr.startState.field(documentReferenceCatalogField, false)
      !== tr.state.field(documentReferenceCatalogField, false)
    || tr.startState.field(bibDataField, false) !== tr.state.field(bibDataField, false);
}

export const referencePresentationField = StateField.define<ReferencePresentationModel>({
  create(state) {
    return createReferencePresentationModel(state);
  },

  update(value, tr) {
    return referencePresentationDependenciesChanged(tr)
      ? createReferencePresentationModel(tr.state)
      : value;
  },
});

export function getReferencePresentationModel(
  state: EditorState,
): ReferencePresentationModel {
  return state.field(referencePresentationField, false) ?? createReferencePresentationModel(state);
}

export function getReferencePresentationComputationCountForTest(): number {
  return referencePresentationComputationCount;
}

export function resetReferencePresentationComputationCountForTest(): void {
  referencePresentationComputationCount = 0;
}
