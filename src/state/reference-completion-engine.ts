/**
 * Barrel for reference-completion helpers. Concrete logic lives in:
 *   - reference-completion-search.ts — parsing + candidate querying
 *   - reference-completion-preview.ts — preview source assembly + formatting
 *
 * Kept as a stable import path for existing consumers (#169 split).
 */
export {
  applyBracketedReferenceCompletion,
  filterReferenceCompletionCandidates,
  findReferenceCompletionMatch,
  type ReferenceCompletionMatch,
} from "./reference-completion-search";

export {
  collectReferenceCompletionCandidates,
  type ReferenceCompletionCandidate,
  type ReferenceCompletionDependencies,
  type ReferenceCompletionPreviewSource,
} from "./reference-completion-preview";
