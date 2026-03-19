/**
 * Minimal type declarations for the citeproc module.
 *
 * citeproc-js ships without TypeScript declarations. This stub covers the
 * API surface used by CslProcessor.
 */

declare module "citeproc" {
  /** System object required by the citeproc Engine constructor. */
  interface CiteSystem {
    retrieveLocale(lang: string): string;
    retrieveItem(id: string): unknown;
  }

  /** A single citation item passed to makeCitationCluster / processCitationCluster. */
  interface CiteprocCitationItem {
    id: string;
    locator?: string;
    label?: string;
  }

  /** A citation cluster passed to processCitationCluster. */
  interface CiteprocCitation {
    citationItems: CiteprocCitationItem[];
    properties: { noteIndex: number };
    citationID: string;
  }

  /** The citeproc-js citation engine. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  class Engine {
    constructor(sys: CiteSystem, styleXml: string);
    makeCitationCluster(items: CiteprocCitationItem[]): string;
    processCitationCluster(
      citation: CiteprocCitation,
      citationsPre: Array<[string, number]>,
      citationsPost: Array<[string, number]>,
    ): [Record<string, unknown>, Array<[number, string]>];
    makeBibliography(): [Record<string, unknown>, string[]];
    updateItems(ids: string[]): void;
  }

  const CSL: { Engine: typeof Engine };
  export default CSL;
}
