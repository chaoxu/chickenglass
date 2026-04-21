import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BackgroundIndexer } from "../../index/indexer";
import type { IndexEntry, IndexQuery, SourceTextQuery } from "../../index/query-api";
import { SEARCH_RESULT_LIMIT, useSearchPanelController } from "./use-search-panel-controller";

type UseSearchPanelControllerProps = Parameters<typeof useSearchPanelController>[0];

function createIndexEntry(
  overrides: Partial<IndexEntry> & Pick<IndexEntry, "type" | "file" | "position">,
): IndexEntry {
  return {
    content: "",
    ...overrides,
  };
}

function createMockIndexer() {
  let resolveQuery: ((entries: readonly IndexEntry[]) => void) | null = null;
  let rejectQuery: ((error: Error) => void) | null = null;

  const querySpy = vi.fn<(query: IndexQuery) => Promise<readonly IndexEntry[]>>(
    () => new Promise<readonly IndexEntry[]>((resolve, reject) => {
      resolveQuery = resolve;
      rejectQuery = reject;
    }),
  );
  const querySourceTextSpy = vi.fn<(query: SourceTextQuery) => Promise<readonly IndexEntry[]>>(
    () => new Promise<readonly IndexEntry[]>((resolve, reject) => {
      resolveQuery = resolve;
      rejectQuery = reject;
    }),
  );

  return {
    indexer: {
      query: querySpy,
      querySourceText: querySourceTextSpy,
    } as unknown as BackgroundIndexer,
    querySpy,
    querySourceTextSpy,
    resolve(entries: readonly IndexEntry[] = []) {
      resolveQuery?.(entries);
      resolveQuery = null;
      rejectQuery = null;
    },
    reject(error = new Error("test")) {
      rejectQuery?.(error);
      resolveQuery = null;
      rejectQuery = null;
    },
  };
}

function createProps(
  indexer: BackgroundIndexer,
  overrides: Partial<UseSearchPanelControllerProps> = {},
): UseSearchPanelControllerProps {
  return {
    open: true,
    searchMode: "semantic",
    searchVersion: 0,
    indexer,
    ...overrides,
  };
}

describe("useSearchPanelController", () => {
  it("resets query, filter, and async state when the panel closes", async () => {
    const mock = createMockIndexer();
    const { result, rerender } = renderHook(useSearchPanelController, {
      initialProps: createProps(mock.indexer),
    });

    act(() => {
      result.current.setQuery("alpha");
      result.current.setTypeFilter("theorem");
    });

    await waitFor(() => {
      expect(mock.querySpy).toHaveBeenCalledWith({
        content: "alpha",
        limit: SEARCH_RESULT_LIMIT + 1,
        type: "theorem",
      });
      expect(result.current.searching).toBe(true);
    });

    rerender(createProps(mock.indexer, { open: false }));

    await waitFor(() => {
      expect(result.current.query).toBe("");
      expect(result.current.typeFilter).toBe("");
      expect(result.current.results).toEqual([]);
      expect(result.current.hasMore).toBe(false);
      expect(result.current.searching).toBe(false);
    });

    mock.resolve([
      createIndexEntry({
        type: "theorem",
        file: "notes.md",
        position: { from: 0, to: 5 },
        content: "alpha theorem",
      }),
    ]);

    await waitFor(() => {
      expect(result.current.results).toEqual([]);
      expect(result.current.hasMore).toBe(false);
      expect(result.current.searching).toBe(false);
    });
  });

  it("clears the type filter and re-queries in source mode", async () => {
    const mock = createMockIndexer();
    const { result, rerender } = renderHook(useSearchPanelController, {
      initialProps: createProps(mock.indexer),
    });

    act(() => {
      result.current.setQuery("alpha");
      result.current.setTypeFilter("proof");
    });

    await waitFor(() => {
      expect(mock.querySpy).toHaveBeenCalledWith({
        content: "alpha",
        limit: SEARCH_RESULT_LIMIT + 1,
        type: "proof",
      });
    });

    rerender(createProps(mock.indexer, { searchMode: "source" }));

    await waitFor(() => {
      expect(result.current.query).toBe("alpha");
      expect(result.current.typeFilter).toBe("");
      expect(mock.querySourceTextSpy).toHaveBeenCalledWith({
        text: "alpha",
        limit: SEARCH_RESULT_LIMIT + 1,
      });
    });
  });

  it("keeps semantic filter-only searches active", async () => {
    const mock = createMockIndexer();
    const { result } = renderHook(useSearchPanelController, {
      initialProps: createProps(mock.indexer),
    });

    act(() => {
      result.current.setTypeFilter("definition");
    });

    await waitFor(() => {
      expect(mock.querySpy).toHaveBeenCalledWith({
        type: "definition",
        content: undefined,
        limit: SEARCH_RESULT_LIMIT + 1,
      });
      expect(mock.querySourceTextSpy).not.toHaveBeenCalled();
      expect(result.current.searching).toBe(true);
    });
  });

  it("uses source-text queries in source mode", async () => {
    const mock = createMockIndexer();
    const { result } = renderHook(useSearchPanelController, {
      initialProps: createProps(mock.indexer, { searchMode: "source" }),
    });

    act(() => {
      result.current.setQuery(" raw_token_785 ");
    });

    await waitFor(() => {
      expect(mock.querySpy).not.toHaveBeenCalled();
      expect(mock.querySourceTextSpy).toHaveBeenCalledWith({
        text: "raw_token_785",
        limit: SEARCH_RESULT_LIMIT + 1,
      });
      expect(result.current.searching).toBe(true);
    });

    mock.resolve([]);

    await waitFor(() => {
      expect(result.current.searching).toBe(false);
    });
  });

  it("stays idle for empty source-mode queries", () => {
    const mock = createMockIndexer();
    const { result } = renderHook(useSearchPanelController, {
      initialProps: createProps(mock.indexer, { searchMode: "source" }),
    });

    expect(mock.querySpy).not.toHaveBeenCalled();
    expect(mock.querySourceTextSpy).not.toHaveBeenCalled();
    expect(result.current.results).toEqual([]);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.searching).toBe(false);
  });

  it("clears results after a failed search", async () => {
    const mock = createMockIndexer();
    const { result } = renderHook(useSearchPanelController, {
      initialProps: createProps(mock.indexer),
    });

    act(() => {
      result.current.setQuery("alpha");
    });

    await waitFor(() => {
      expect(mock.querySpy).toHaveBeenCalledWith({
        content: "alpha",
        limit: SEARCH_RESULT_LIMIT + 1,
        type: undefined,
      });
      expect(result.current.searching).toBe(true);
    });

    mock.reject(new Error("index error"));

    await waitFor(() => {
      expect(result.current.results).toEqual([]);
      expect(result.current.hasMore).toBe(false);
      expect(result.current.searching).toBe(false);
    });
  });

  it("reruns the current search when searchVersion changes", async () => {
    const mock = createMockIndexer();
    const entry = createIndexEntry({
      type: "heading",
      file: "chapter1.md",
      title: "Alpha",
      position: { from: 12, to: 17 },
      content: "alpha heading",
    });
    const { result, rerender } = renderHook(useSearchPanelController, {
      initialProps: createProps(mock.indexer),
    });

    act(() => {
      result.current.setQuery("alpha");
    });

    await waitFor(() => {
      expect(mock.querySpy).toHaveBeenCalledTimes(1);
    });

    mock.resolve([entry]);

    await waitFor(() => {
      expect(result.current.results).toEqual([entry]);
      expect(result.current.hasMore).toBe(false);
      expect(result.current.searching).toBe(false);
    });

    rerender(createProps(mock.indexer, { searchVersion: 1 }));

    await waitFor(() => {
      expect(mock.querySpy).toHaveBeenCalledTimes(2);
      expect(result.current.searching).toBe(true);
    });

    mock.resolve([entry]);

    await waitFor(() => {
      expect(result.current.results).toEqual([entry]);
      expect(result.current.hasMore).toBe(false);
      expect(result.current.searching).toBe(false);
    });
  });

  it("caps oversized result sets and exposes hasMore", async () => {
    const mock = createMockIndexer();
    const entries = Array.from({ length: SEARCH_RESULT_LIMIT + 1 }, (_, index) => (
      createIndexEntry({
        type: "heading",
        file: "chapter1.md",
        title: `Alpha ${index}`,
        position: { from: index, to: index + 1 },
        content: "alpha heading",
      })
    ));
    const { result } = renderHook(useSearchPanelController, {
      initialProps: createProps(mock.indexer),
    });

    act(() => {
      result.current.setQuery("alpha");
    });

    await waitFor(() => {
      expect(mock.querySpy).toHaveBeenCalledWith({
        content: "alpha",
        limit: SEARCH_RESULT_LIMIT + 1,
        type: undefined,
      });
    });

    mock.resolve(entries);

    await waitFor(() => {
      expect(result.current.results).toHaveLength(SEARCH_RESULT_LIMIT);
      expect(result.current.hasMore).toBe(true);
      expect(result.current.searching).toBe(false);
    });
  });
});
