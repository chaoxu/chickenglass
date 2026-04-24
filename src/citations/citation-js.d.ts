/**
 * Minimal type declarations for citation-js modules.
 *
 * citation-js ships without TypeScript declarations. These stubs cover the
 * API surface used by bibtex-parser.ts and csl-processor.ts.
 */

declare module "@citation-js/core" {
  /** CSL-JSON item produced by citation-js parsing. */
  interface CslJsonItem {
    id: string;
    type: string;
    [key: string]: unknown;
  }

  /** The main Cite class for parsing and formatting citations. */
  class Cite {
    constructor(data: unknown, options?: Record<string, unknown>);
    data: CslJsonItem[];
    format(type: string, options?: Record<string, unknown>): string;
    static input(data: unknown): CslJsonItem[];
  }

  /** A single citation item passed to makeCitationCluster / processCitationCluster. */
  interface CiteprocCitationItem {
    id: string;
    locator?: string;
    label?: string;
    "author-only"?: boolean;
    "suppress-author"?: boolean;
  }

  /** A citation cluster passed to processCitationCluster. */
  interface CiteprocCitation {
    citationItems: CiteprocCitationItem[];
    properties: { noteIndex: number };
    citationID: string;
  }

  interface CiteprocBibliographyParams extends Record<string, unknown> {
    entry_ids?: Array<string | string[]>;
  }

  /** The citeproc-js engine (exposed via citation-js plugin-csl). */
  interface CiteprocEngine {
    makeCitationCluster(items: CiteprocCitationItem[]): string;
    processCitationCluster(
      citation: CiteprocCitation,
      citationsPre: Array<[string, number]>,
      citationsPost: Array<[string, number]>,
    ): [Record<string, unknown>, Array<[number, string]>];
    makeBibliography(): [CiteprocBibliographyParams, string[]];
    updateItems(ids: string[]): void;
  }

  /** CSL template store. */
  interface CslTemplateStore {
    add(name: string, template: string): void;
    has(name: string): boolean;
    get(name: string): string;
  }

  /** CSL plugin configuration shape. */
  interface CslConfig {
    engine: (data: unknown[], template: string, locale: string, format: string) => CiteprocEngine;
    templates: CslTemplateStore;
    locales: CslTemplateStore;
  }

  /** Plugin registry and configuration. */
  const plugins: {
    config: {
      get(name: "@csl"): CslConfig;
      get(name: string): Record<string, unknown>;
    };
    add(name: string, plugin: Record<string, unknown>): void;
  };

  export { Cite, plugins };
  export type { CiteprocEngine, CiteprocCitationItem, CiteprocCitation, CslConfig };
}

declare module "@citation-js/plugin-bibtex" {
  // Side-effect-only import: registers BibTeX input plugin with @citation-js/core
}

declare module "@citation-js/plugin-csl" {
  // Side-effect-only import: registers CSL output plugin with @citation-js/core
}
