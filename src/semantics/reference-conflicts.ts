import { isLikelyLocalReferenceId } from "../lib/markdown/label-graph";
import type { DocumentAnalysis, ReferenceSemantics } from "./document";
import {
  buildDocumentReferenceCatalog,
  type DocumentReferenceTarget,
} from "./reference-catalog";

export interface DuplicateReferenceTargetConflict {
  readonly kind: "duplicate-target";
  readonly id: string;
  readonly targets: readonly DocumentReferenceTarget[];
}

export interface UnresolvedReferenceConflict {
  readonly kind: "unresolved-reference";
  readonly id: string;
  readonly reference: ReferenceSemantics;
}

export interface CitationLocalTargetCollisionConflict {
  readonly kind: "citation-local-target-collision";
  readonly id: string;
  readonly targets: readonly DocumentReferenceTarget[];
}

export type ReferenceConflict =
  | DuplicateReferenceTargetConflict
  | UnresolvedReferenceConflict
  | CitationLocalTargetCollisionConflict;

export type ReferenceLookup = Pick<ReadonlyMap<string, unknown>, "has">;

export interface ReferenceConflictModelOptions {
  readonly bibliography?: ReferenceLookup;
  readonly localOnlyWithoutBibliography?: boolean;
}

export interface ReferenceConflictModel {
  readonly conflicts: readonly ReferenceConflict[];
  readonly duplicatesById: ReadonlyMap<string, readonly DocumentReferenceTarget[]>;
  readonly citationLocalTargetCollisions: readonly CitationLocalTargetCollisionConflict[];
  readonly unresolvedReferences: readonly UnresolvedReferenceConflict[];
}

export function buildReferenceConflictModel(
  analysis: DocumentAnalysis,
  options: ReferenceConflictModelOptions = {},
): ReferenceConflictModel {
  const catalog = buildDocumentReferenceCatalog(analysis);
  const duplicates: DuplicateReferenceTargetConflict[] = [];
  const citationLocalTargetCollisions: CitationLocalTargetCollisionConflict[] = [];
  const unresolvedReferences: UnresolvedReferenceConflict[] = [];
  const { bibliography, localOnlyWithoutBibliography = false } = options;

  for (const [id, targets] of catalog.duplicatesById) {
    duplicates.push({ kind: "duplicate-target", id, targets });
  }

  if (bibliography) {
    for (const [id, targets] of catalog.targetsById) {
      if (bibliography.has(id)) {
        citationLocalTargetCollisions.push({
          kind: "citation-local-target-collision",
          id,
          targets,
        });
      }
    }
  }

  for (const reference of catalog.references) {
    for (const id of reference.ids) {
      if (!bibliography && localOnlyWithoutBibliography && !isLikelyLocalReferenceId(id)) {
        continue;
      }
      if (catalog.targetsById.has(id)) {
        continue;
      }
      if (bibliography?.has(id)) {
        continue;
      }
      unresolvedReferences.push({
        kind: "unresolved-reference",
        id,
        reference,
      });
    }
  }

  return {
    conflicts: [...duplicates, ...citationLocalTargetCollisions, ...unresolvedReferences],
    duplicatesById: catalog.duplicatesById,
    citationLocalTargetCollisions,
    unresolvedReferences,
  };
}
