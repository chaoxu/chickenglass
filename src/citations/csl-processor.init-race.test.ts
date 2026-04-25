import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CitationJsModules, CitationJsLoader } from "./csl-processor";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.resetModules();
});

describe("CslProcessor init races", () => {
  it("does not format with the old engine while setStyle is pending", async () => {
    const templatesAdd = vi.fn();
    const engineFactory = vi.fn((_data, styleName: string) => ({
      styleName,
      makeBibliography: () => [{ entry_ids: [["alpha2020"]] }, [`<div>${styleName}</div>`]],
      makeCitationCluster: () => styleName,
      processCitationCluster: () => undefined,
      updateItems: () => undefined,
    }));
    const loader: CitationJsLoader = async () => ({
      plugins: {
        config: {
          get: () => ({
            templates: { add: templatesAdd },
            engine: engineFactory,
          }),
        },
      },
    }) as unknown as CitationJsModules;

    const { CslProcessor, setCitationJsLoaderForTest } = await import("./csl-processor");
    setCitationJsLoaderForTest(loader);
    const processor = await CslProcessor.create([
      {
        id: "alpha2020",
        type: "article-journal",
        author: [{ family: "Alpha" }],
        issued: { "date-parts": [[2020]] },
      },
    ]);
    const oldCitation = processor.cite(["alpha2020"]);

    const setStylePromise = processor.setStyle("<style>custom</style>");

    expect(processor.cite(["alpha2020"])).toBe("");
    expect(processor.citeNarrative("alpha2020")).toBe("Alpha (2020)");
    expect(processor.bibliography(["alpha2020"])).toEqual([]);

    await setStylePromise;

    expect(processor.cite(["alpha2020"])).not.toBe(oldCitation);
    expect(processor.cite(["alpha2020"])).toBe(engineFactory.mock.results[1]?.value.styleName);
  });

  it("ignores stale constructor init when a later setStyle wins", async () => {
    let releaseCoreImport: (() => void) | undefined;
    const coreImportGate = new Promise<void>((resolve) => {
      releaseCoreImport = resolve;
    });
    const templatesAdd = vi.fn();
    const engineFactory = vi.fn((_data, styleName: string) => ({ styleName }));
    const loader: CitationJsLoader = async () => {
      await coreImportGate;
      return {
        plugins: {
          config: {
            get: () => ({
              templates: { add: templatesAdd },
              engine: engineFactory,
            }),
          },
        },
      } as unknown as CitationJsModules;
    };

    const { CslProcessor, setCitationJsLoaderForTest } = await import("./csl-processor");
    setCitationJsLoaderForTest(loader);
    const processor = new CslProcessor([
      { id: "alpha2020", type: "article-journal" },
    ]);

    const setStylePromise = processor.setStyle("<style>custom</style>");
    releaseCoreImport?.();
    await setStylePromise;
    await Promise.resolve();

    const internal = processor as unknown as {
      engine: { styleName: string } | null;
    };

    expect(engineFactory).toHaveBeenCalledTimes(1);
    expect(templatesAdd).toHaveBeenCalledTimes(1);
    expect(internal.engine).toEqual(
      expect.objectContaining({ styleName: engineFactory.mock.calls[0]?.[1] }),
    );
    expect(processor.revision).toBe(1);
  });

  it("coalesces overlapping setStyle calls to the latest request", async () => {
    let releaseCoreImport: (() => void) | undefined;
    const coreImportGate = new Promise<void>((resolve) => {
      releaseCoreImport = resolve;
    });
    const templatesAdd = vi.fn();
    const engineFactory = vi.fn((_data, styleName: string) => ({ styleName }));
    const loader: CitationJsLoader = async () => {
      await coreImportGate;
      return {
        plugins: {
          config: {
            get: () => ({
              templates: { add: templatesAdd },
              engine: engineFactory,
            }),
          },
        },
      } as unknown as CitationJsModules;
    };

    const { CslProcessor, setCitationJsLoaderForTest } = await import("./csl-processor");
    setCitationJsLoaderForTest(loader);
    const processor = new CslProcessor([
      { id: "alpha2020", type: "article-journal" },
    ]);

    const first = processor.setStyle("<style>first</style>");
    const second = processor.setStyle("<style>second</style>");
    const third = processor.setStyle("<style>third</style>");
    releaseCoreImport?.();

    await Promise.all([first, second, third]);
    await Promise.resolve();

    const internal = processor as unknown as {
      engine: { styleName: string } | null;
    };

    expect(engineFactory).toHaveBeenCalledTimes(1);
    expect(templatesAdd).toHaveBeenCalledTimes(1);
    expect(internal.engine).toEqual(
      expect.objectContaining({ styleName: engineFactory.mock.calls[0]?.[1] }),
    );
    expect(processor.revision).toBe(1);
  });
});
