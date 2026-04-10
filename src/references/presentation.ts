import type { EditorState } from "@codemirror/state";
import type { CslJsonItem } from "../citations/bibtex-parser";
import { formatCitationPreview } from "../citations/citation-preview";
import { getEditorDocumentReferenceCatalog } from "../semantics/editor-reference-catalog";
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

const citationFormatCache = new WeakMap<
  object,
  WeakMap<BibStore, Map<string, CachedCitationFormat>>
>();

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

function getReferenceCacheScope(state: EditorState): object {
  return state.doc;
}

function getCitationFormatEntries(
  scope: object,
  store: BibStore,
): Map<string, CachedCitationFormat> {
  let byStore = citationFormatCache.get(scope);
  if (!byStore) {
    byStore = new WeakMap<BibStore, Map<string, CachedCitationFormat>>();
    citationFormatCache.set(scope, byStore);
  }

  let entries = byStore.get(store);
  if (!entries) {
    entries = new Map<string, CachedCitationFormat>();
    byStore.set(store, entries);
  }

  return entries;
}

function getCachedCitationFormat(
  scope: object,
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

  const entries = getCitationFormatEntries(scope, store);
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

export function getReferencePresentationModel(
  state: EditorState,
): ReferencePresentationModel {
  const scope = getReferenceCacheScope(state);
  const store = state.field(bibDataField, false)?.store;
  const catalog = getEditorDocumentReferenceCatalog(state);

  return {
    getDisplayText(id) {
      const target = getPreferredDocumentReferenceTarget(catalog, id);
      if (target) {
        return target.displayLabel;
      }

      return getCachedCitationFormat(scope, store, id)?.display ?? id;
    },

    getPreviewText(id) {
      return getCachedCitationFormat(scope, store, id)?.preview;
    },
  };
}

export function getReferencePresentationComputationCountForTest(): number {
  return referencePresentationComputationCount;
}

export function resetReferencePresentationComputationCountForTest(): void {
  referencePresentationComputationCount = 0;
}
