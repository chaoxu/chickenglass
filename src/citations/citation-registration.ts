import type { DocumentAnalysis } from "../semantics/document";
import { type BibStore } from "../state/bib-data";
import {
  type CslProcessor,
  collectCitationMatches,
  getCitationRegistrationKey,
  registerCitationsWithProcessor,
} from "./csl-processor";

/**
 * Ensure citations from the current document analysis are registered with the
 * CSL processor. Registration state is tracked on the processor itself so
 * shared render surfaces can reuse one authoritative cache key.
 */
export function ensureCitationsRegistered(
  analysis: DocumentAnalysis,
  store: BibStore,
  processor: CslProcessor,
): void {
  const matches = collectCitationMatches(analysis.references, store);
  const registrationKey = getCitationRegistrationKey(matches);
  if (processor.citationRegistrationKey === registrationKey) {
    return;
  }

  registerCitationsWithProcessor(matches, processor);
}
