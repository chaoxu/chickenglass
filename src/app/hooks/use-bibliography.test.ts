import { describe, expect, it, vi, beforeEach } from "vitest";
import type { EditorView } from "@codemirror/view";
import type { FileSystem } from "../file-manager";
import { createMockEditorView } from "../../test-utils";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useRef: <T,>(value: T) => ({ current: value }),
    useCallback: <T,>(fn: T) => fn,
  };
});

import { useBibliography, clearBootstrapCache } from "./use-bibliography";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createView(): { view: EditorView; dispatch: ReturnType<typeof vi.fn> } {
  const dispatch = vi.fn();
  const view = createMockEditorView({ dispatch });
  return { view, dispatch };
}

function getDispatchedStoreIds(dispatch: ReturnType<typeof vi.fn>): string[] {
  const lastSpec = dispatch.mock.calls.at(-1)?.[0] as {
    effects: { value: { store: ReadonlyMap<string, unknown> } };
  };
  return [...lastSpec.effects.value.store.keys()];
}

const OLD_BIB = `@article{old2000,
  author = {Old, Author},
  title = {Old Paper},
  year = {2000}
}`;

const NEW_BIB = `@article{new2001,
  author = {New, Author},
  title = {New Paper},
  year = {2001}
}`;

describe("useBibliography", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearBootstrapCache();
  });

  it("ignores an older handleBibChange load that resolves after a newer one", async () => {
    const oldLoad = deferred<string>();
    const fs = {
      readFile: vi.fn((path: string) => {
        if (path === "notes/old.bib") return oldLoad.promise;
        if (path === "notes/new.bib") return Promise.resolve(NEW_BIB);
        throw new Error(`unexpected path: ${path}`);
      }),
    } as unknown as FileSystem;
    const { view, dispatch } = createView();
    const { handleBibChange } = useBibliography({
      fs,
      docPath: "notes/doc.md",
    });

    handleBibChange("old.bib", "", view);
    handleBibChange("new.bib", "", view);

    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledTimes(1);
    });
    expect(getDispatchedStoreIds(dispatch)).toEqual(["new2001"]);

    oldLoad.resolve(OLD_BIB);
    await Promise.resolve();
    await Promise.resolve();

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(getDispatchedStoreIds(dispatch)).toEqual(["new2001"]);
  });

  it("ignores a stale initial load after frontmatter switches to a newer bibliography", async () => {
    const oldLoad = deferred<string>();
    const fs = {
      readFile: vi.fn((path: string) => {
        if (path === "notes/old.bib") return oldLoad.promise;
        if (path === "notes/new.bib") return Promise.resolve(NEW_BIB);
        throw new Error(`unexpected path: ${path}`);
      }),
    } as unknown as FileSystem;
    const { view, dispatch } = createView();
    const { loadInitial, handleBibChange } = useBibliography({
      fs,
      docPath: "notes/doc.md",
    });

    loadInitial("old.bib", "", view);
    handleBibChange("new.bib", "", view);

    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledTimes(1);
    });
    expect(getDispatchedStoreIds(dispatch)).toEqual(["new2001"]);

    oldLoad.resolve(OLD_BIB);
    await Promise.resolve();
    await Promise.resolve();

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(getDispatchedStoreIds(dispatch)).toEqual(["new2001"]);
  });

  it("reuses cached bootstrap when reopening with same bib content", async () => {
    let readCount = 0;
    const fs = {
      readFile: vi.fn((path: string) => {
        readCount++;
        if (path === "notes/refs.bib") return Promise.resolve(NEW_BIB);
        throw new Error(`unexpected path: ${path}`);
      }),
    } as unknown as FileSystem;

    // First load — cold cache
    const { view: view1, dispatch: dispatch1 } = createView();
    const hook1 = useBibliography({ fs, docPath: "notes/doc.md" });
    hook1.loadInitial("refs.bib", "", view1);
    await vi.waitFor(() => {
      expect(dispatch1).toHaveBeenCalledTimes(1);
    });
    expect(getDispatchedStoreIds(dispatch1)).toEqual(["new2001"]);
    const firstReadCount = readCount;

    // Second load — same content, should hit bootstrap cache
    const { view: view2, dispatch: dispatch2 } = createView();
    const hook2 = useBibliography({ fs, docPath: "notes/doc.md" });
    hook2.loadInitial("refs.bib", "", view2);
    await vi.waitFor(() => {
      expect(dispatch2).toHaveBeenCalledTimes(1);
    });
    expect(getDispatchedStoreIds(dispatch2)).toEqual(["new2001"]);

    // File was read again (to check content), but total reads should only
    // be 2 (one per load), not more — no extra CSL reads or re-reads.
    expect(readCount).toBe(firstReadCount + 1);
  });

  it("does not reuse cached bootstrap when bib content changes", async () => {
    let bibContent = OLD_BIB;
    const fs = {
      readFile: vi.fn(() => Promise.resolve(bibContent)),
    } as unknown as FileSystem;

    const { view: view1, dispatch: dispatch1 } = createView();
    const hook1 = useBibliography({ fs, docPath: "notes/doc.md" });
    hook1.loadInitial("refs.bib", "", view1);
    await vi.waitFor(() => {
      expect(dispatch1).toHaveBeenCalledTimes(1);
    });
    expect(getDispatchedStoreIds(dispatch1)).toEqual(["old2000"]);

    // Change bib content — cache should miss
    bibContent = NEW_BIB;
    const { view: view2, dispatch: dispatch2 } = createView();
    const hook2 = useBibliography({ fs, docPath: "notes/doc.md" });
    hook2.loadInitial("refs.bib", "", view2);
    await vi.waitFor(() => {
      expect(dispatch2).toHaveBeenCalledTimes(1);
    });
    expect(getDispatchedStoreIds(dispatch2)).toEqual(["new2001"]);
  });
});
