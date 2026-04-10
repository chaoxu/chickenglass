import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BackgroundIndexer } from "../../index/indexer";
import type { IndexEntry, IndexQuery, SourceTextQuery } from "../../index/query-api";
import { useSearchPanelController } from "./use-search-panel-controller";

function createMockIndexer(): BackgroundIndexer {
  return {
    query: vi.fn<(query: IndexQuery) => Promise<readonly IndexEntry[]>>(async () => []),
    querySourceText: vi.fn<(query: SourceTextQuery) => Promise<readonly IndexEntry[]>>(async () => []),
  } as unknown as BackgroundIndexer;
}

describe("useSearchPanelController", () => {
  it("resets query and type filter when the panel closes", async () => {
    const { result, rerender } = renderHook(useSearchPanelController, {
      initialProps: {
        open: true,
        searchMode: "semantic" as const,
        searchVersion: 0,
        indexer: createMockIndexer(),
      },
    });

    act(() => {
      result.current.setQuery("alpha");
      result.current.setTypeFilter("theorem");
    });

    expect(result.current.query).toBe("alpha");
    expect(result.current.typeFilter).toBe("theorem");

    rerender({
      open: false,
      searchMode: "semantic",
      searchVersion: 0,
      indexer: createMockIndexer(),
    });

    await waitFor(() => {
      expect(result.current.query).toBe("");
      expect(result.current.typeFilter).toBe("");
      expect(result.current.results).toEqual([]);
      expect(result.current.searching).toBe(false);
    });
  });

  it("clears the type filter when switching to source mode", async () => {
    const { result, rerender } = renderHook(useSearchPanelController, {
      initialProps: {
        open: true,
        searchMode: "semantic" as const,
        searchVersion: 0,
        indexer: createMockIndexer(),
      },
    });

    act(() => {
      result.current.setQuery("alpha");
      result.current.setTypeFilter("proof");
    });

    rerender({
      open: true,
      searchMode: "source",
      searchVersion: 0,
      indexer: createMockIndexer(),
    });

    await waitFor(() => {
      expect(result.current.query).toBe("alpha");
      expect(result.current.typeFilter).toBe("");
    });
  });
});
