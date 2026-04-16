declare module "@citation-js/core" {
  interface CslJsonItem {
    id: string;
    type: string;
    [key: string]: unknown;
  }

  class Cite {
    constructor(data: unknown, options?: Record<string, unknown>);
    data: CslJsonItem[];
    format(type: string, options?: Record<string, unknown>): string;
    static input(data: unknown): CslJsonItem[];
  }

  interface CiteprocCitationItem {
    id: string;
    locator?: string;
    label?: string;
    "author-only"?: boolean;
    "suppress-author"?: boolean;
  }

  interface CiteprocCitation {
    citationItems: CiteprocCitationItem[];
    properties: { noteIndex: number };
    citationID: string;
  }

  interface CiteprocEngine {
    makeCitationCluster(items: CiteprocCitationItem[]): string;
    processCitationCluster(
      citation: CiteprocCitation,
      citationsPre: Array<[string, number]>,
      citationsPost: Array<[string, number]>,
    ): [Record<string, unknown>, Array<[number, string, string?]>];
    previewCitationCluster(
      citation: Omit<CiteprocCitation, "citationID"> & { citationID?: string },
      citationsPre: Array<[string, number]>,
      citationsPost: Array<[string, number]>,
      newMode: "html" | "text" | "rtf",
    ): string;
    makeBibliography(): [Record<string, unknown>, string[]];
    updateItems(ids: string[]): void;
  }

  interface CslTemplateStore {
    add(name: string, template: string): void;
    has(name: string): boolean;
    get(name: string): string;
  }

  interface CslConfig {
    engine: (data: unknown[], template: string, locale: string, format: string) => CiteprocEngine;
    templates: CslTemplateStore;
    locales: CslTemplateStore;
  }

  const plugins: {
    config: {
      get(name: "@csl"): CslConfig;
      get(name: string): Record<string, unknown>;
    };
    add(name: string, plugin: Record<string, unknown>): void;
  };

  export { Cite, plugins };
  export type { CiteprocCitation, CiteprocCitationItem, CiteprocEngine };
}

declare module "@citation-js/plugin-bibtex" {}
declare module "@citation-js/plugin-csl" {}
