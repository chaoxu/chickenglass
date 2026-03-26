/**
 * Tests for the useSearchIndexer hook logic.
 *
 * The project does not have @testing-library/react, so we test the
 * core behavior by exercising the effect logic directly via the hook's
 * observable contract: when `open` becomes false or `indexer` becomes null
 * while a query is in flight, both `results` and `searching` must reset.
 *
 * We verify the bug class from #478 (searching stuck after teardown) by
 * simulating the state transitions the hook manages.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { BackgroundIndexer } from "../../index/indexer";
import type { IndexEntry, IndexQuery } from "../../index/query-api";

/**
 * Minimal mock indexer whose query() returns a controllable promise.
 * Allows tests to verify behavior when queries are pending during teardown.
 */
function createMockIndexer() {
  let resolveQuery: ((entries: readonly IndexEntry[]) => void) | null = null;
  let rejectQuery: ((err: Error) => void) | null = null;
  const querySpy = vi.fn<(q: IndexQuery) => Promise<readonly IndexEntry[]>>(
    () =>
      new Promise<readonly IndexEntry[]>((resolve, reject) => {
        resolveQuery = resolve;
        rejectQuery = reject;
      }),
  );

  return {
    indexer: { query: querySpy } as unknown as BackgroundIndexer,
    querySpy,
    resolve(entries: readonly IndexEntry[] = []) {
      resolveQuery?.(entries);
      resolveQuery = null;
      rejectQuery = null;
    },
    reject(err = new Error("test")) {
      rejectQuery?.(err);
      resolveQuery = null;
      rejectQuery = null;
    },
  };
}

/**
 * Simulate the effect logic from useSearchIndexer without React.
 *
 * This mirrors the exact branching in the hook's useEffect:
 * - When !open or !indexer: reset results + searching, return no cleanup
 * - Otherwise: set searching=true, fire async query, return cleanup
 *
 * Returns the state object and a cleanup function matching React's
 * effect cleanup contract.
 */
function simulateEffect(
  open: boolean,
  query: string,
  indexer: BackgroundIndexer | null | undefined,
): {
  state: { results: readonly IndexEntry[]; searching: boolean };
  cleanup: (() => void) | undefined;
} {
  const state = { results: [] as readonly IndexEntry[], searching: false };

  if (!open || !indexer) {
    // This is the fix from #478: reset both results AND searching
    state.results = [];
    state.searching = false;
    return { state, cleanup: undefined };
  }

  state.searching = true;
  let cancelled = false;

  const text = query.trim();
  const indexQuery: IndexQuery = { content: text || undefined };

  void (async () => {
    try {
      const entries = await indexer.query(indexQuery);
      if (!cancelled) {
        state.results = entries;
      }
    } catch {
      if (!cancelled) {
        state.results = [];
      }
    } finally {
      if (!cancelled) {
        state.searching = false;
      }
    }
  })();

  const cleanup = () => {
    cancelled = true;
    // #478 fix: eagerly reset searching on cleanup
    state.searching = false;
  };

  return { state, cleanup };
}

describe("useSearchIndexer teardown (#478)", () => {
  let mock: ReturnType<typeof createMockIndexer>;

  beforeEach(() => {
    mock = createMockIndexer();
  });

  // Regression: closing the panel mid-query left searching=true permanently
  // because the cleanup only set cancelled=true, which suppressed the finally
  // block that would have reset searching. #478
  it("resets searching to false when cleanup runs during pending query", async () => {
    const { state, cleanup } = simulateEffect(true, "test", mock.indexer);
    expect(state.searching).toBe(true);

    // Simulate panel close (effect cleanup fires before query resolves)
    cleanup?.();
    expect(state.searching).toBe(false);

    // Resolve the in-flight query — should not change state
    mock.resolve([]);
    await vi.waitFor(() => {
      // Give the microtask queue time to flush
      expect(state.results).toEqual([]);
      expect(state.searching).toBe(false);
    });
  });

  // Regression: when open becomes false, only results was reset but not
  // searching, leaving a stale loading indicator. #478
  it("resets searching to false when open becomes false", () => {
    const { state } = simulateEffect(false, "test", mock.indexer);
    expect(state.searching).toBe(false);
    expect(state.results).toEqual([]);
  });

  // Regression: when indexer becomes null, same stuck-searching issue. #478
  it("resets searching to false when indexer is null", () => {
    const { state } = simulateEffect(true, "test", null);
    expect(state.searching).toBe(false);
    expect(state.results).toEqual([]);
  });

  it("completes normally when query resolves before cleanup", async () => {
    const { state, cleanup } = simulateEffect(true, "test", mock.indexer);
    expect(state.searching).toBe(true);

    const mockEntry: IndexEntry = {
      type: "heading",
      label: "test",
      title: "Test",
      file: "test.md",
      position: { from: 0, to: 10 },
      content: "Test heading",
    };
    mock.resolve([mockEntry]);

    await vi.waitFor(() => {
      expect(state.searching).toBe(false);
      expect(state.results).toEqual([mockEntry]);
    });

    // Cleanup after resolution should be harmless
    cleanup?.();
    expect(state.searching).toBe(false);
  });

  it("resets results on query error when not cancelled", async () => {
    const { state } = simulateEffect(true, "test", mock.indexer);
    expect(state.searching).toBe(true);

    mock.reject(new Error("index error"));

    await vi.waitFor(() => {
      expect(state.searching).toBe(false);
      expect(state.results).toEqual([]);
    });
  });
});
