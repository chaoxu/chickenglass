import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@citation-js/core");
  vi.doUnmock("@citation-js/plugin-csl");
});

describe("CslProcessor init races", () => {
  it("ignores stale constructor init when a later setStyle wins", async () => {
    let releaseCoreImport: (() => void) | undefined;
    const coreImportGate = new Promise<void>((resolve) => {
      releaseCoreImport = resolve;
    });
    const templatesAdd = vi.fn();
    const engineFactory = vi.fn((_data, styleName: string) => ({ styleName }));

    vi.doMock("@citation-js/core", async () => {
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
      };
    });
    vi.doMock("@citation-js/plugin-csl", async () => ({}));

    const { CslProcessor } = await import("./csl-processor");
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

    vi.doMock("@citation-js/core", async () => {
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
      };
    });
    vi.doMock("@citation-js/plugin-csl", async () => ({}));

    const { CslProcessor } = await import("./csl-processor");
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
