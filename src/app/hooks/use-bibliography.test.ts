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

import { useBibliography } from "./use-bibliography";

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
});
