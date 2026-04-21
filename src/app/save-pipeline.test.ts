import { describe, expect, it, vi } from "vitest";
import { fnv1aHash, SavePipeline, type SaveSnapshot } from "./save-pipeline";

function createDeferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function createEchoWrite() {
  return vi.fn(async (_path: string, snapshot: SaveSnapshot) => snapshot.content);
}

describe("SavePipeline", () => {
  // ---------------------------------------------------------------------------
  // Revision tracking
  // ---------------------------------------------------------------------------

  it("starts revision at 0 and increments monotonically", () => {
    const pipeline = new SavePipeline(createEchoWrite());
    expect(pipeline.getRevision("a.md")).toBe(0);
    expect(pipeline.bumpRevision("a.md")).toBe(1);
    expect(pipeline.bumpRevision("a.md")).toBe(2);
    expect(pipeline.getRevision("a.md")).toBe(2);
  });

  it("tracks revisions per path independently", () => {
    const pipeline = new SavePipeline(createEchoWrite());
    pipeline.bumpRevision("a.md");
    pipeline.bumpRevision("a.md");
    pipeline.bumpRevision("b.md");
    expect(pipeline.getRevision("a.md")).toBe(2);
    expect(pipeline.getRevision("b.md")).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Save + hash
  // ---------------------------------------------------------------------------

  it("writes content and records saved revision and hash", async () => {
    const writeFn = createEchoWrite();
    const pipeline = new SavePipeline(writeFn);
    pipeline.bumpRevision("a.md");

    const result = await pipeline.save("a.md", () => ({
      content: "hello",
    }));

    expect(result.saved).toBe(true);
    expect(result.lastSavedRevision).toBe(1);
    expect(pipeline.getLastSavedRevision("a.md")).toBe(1);
    expect(pipeline.getLastSavedHash("a.md")).toBe(fnv1aHash("hello"));
    expect(writeFn).toHaveBeenCalledWith("a.md", { content: "hello" });
  });

  it("returns saved: false when the write throws", async () => {
    const writeFn = vi.fn(async () => { throw new Error("disk full"); });
    const pipeline = new SavePipeline(writeFn);
    pipeline.bumpRevision("a.md");

    const result = await pipeline.save("a.md", () => ({
      content: "hello",
    }));

    expect(result.saved).toBe(false);
    expect(pipeline.getLastSavedRevision("a.md")).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Coalescing
  // ---------------------------------------------------------------------------

  it("coalesces concurrent saves: only two writes for three requests", async () => {
    const gate = createDeferred<string>();
    let callCount = 0;
    const writeFn = vi.fn(async (_p: string, snapshot: SaveSnapshot) => {
      callCount++;
      if (callCount === 1) {
        await gate.promise;
      }
      return snapshot.content;
    });
    const pipeline = new SavePipeline(writeFn);
    pipeline.bumpRevision("a.md");

    // First save — held open by gate
    const firstPromise = pipeline.save("a.md", () => ({
      content: "v1",
    }));

    // Queue two more saves while first is in flight
    pipeline.bumpRevision("a.md");
    pipeline.save("a.md", () => ({
      content: "v2",
    }));
    pipeline.bumpRevision("a.md");
    pipeline.save("a.md", () => ({
      content: "v3",
    }));

    // Release the first write
    gate.resolve("");
    await firstPromise;

    // Wait for microtasks
    await new Promise((r) => setTimeout(r, 0));

    // Only 2 writes: v1 (first) and v3 (coalesced)
    expect(writeFn).toHaveBeenCalledTimes(2);
    expect(writeFn).toHaveBeenNthCalledWith(1, "a.md", { content: "v1" });
    expect(writeFn).toHaveBeenNthCalledWith(2, "a.md", { content: "v3" });
    expect(pipeline.getLastSavedHash("a.md")).toBe(fnv1aHash("v3"));
  });

  it("does not re-save when revision did not advance during in-flight write", async () => {
    const gate = createDeferred<string>();
    let callCount = 0;
    const writeFn = vi.fn(async (_p: string, snapshot: SaveSnapshot) => {
      callCount++;
      if (callCount === 1) {
        await gate.promise;
      }
      return snapshot.content;
    });
    const pipeline = new SavePipeline(writeFn);
    pipeline.bumpRevision("a.md");

    const savePromise = pipeline.save("a.md", () => ({
      content: "hello",
    }));

    // Queue a second save WITHOUT bumping revision
    pipeline.save("a.md", () => ({
      content: "hello",
    }));

    gate.resolve("");
    await savePromise;
    await new Promise((r) => setTimeout(r, 0));

    // Only 1 write — the coalesced save was skipped because revision didn't advance
    expect(writeFn).toHaveBeenCalledTimes(1);
  });

  it("persists content when user edits back to clean state during in-flight save", async () => {
    const gate = createDeferred<string>();
    let callCount = 0;
    const writeFn = vi.fn(async (_p: string, snapshot: SaveSnapshot) => {
      callCount++;
      if (callCount === 1) {
        await gate.promise;
      }
      return snapshot.content;
    });
    const pipeline = new SavePipeline(writeFn);
    pipeline.bumpRevision("a.md");

    const savePromise = pipeline.save("a.md", () => ({
      content: "dirty",
    }));

    // User types more and queues another save
    pipeline.bumpRevision("a.md");
    pipeline.save("a.md", () => ({
      content: "dirty-then-clean",
    }));

    gate.resolve("");
    const result = await savePromise;
    await new Promise((r) => setTimeout(r, 0));

    expect(result.saved).toBe(true);
    expect(writeFn).toHaveBeenCalledTimes(2);
    expect(pipeline.getLastSavedHash("a.md")).toBe(fnv1aHash("dirty-then-clean"));
  });

  // ---------------------------------------------------------------------------
  // Self-change suppression
  // ---------------------------------------------------------------------------

  it("marks recent saves as self-changes when disk content matches", async () => {
    const pipeline = new SavePipeline(createEchoWrite());
    pipeline.bumpRevision("a.md");

    await pipeline.save("a.md", () => ({ content: "saved" }));

    expect(pipeline.isSelfChange("a.md", "saved")).toBe(true);
  });

  it("detects external rewrite within suppression window", async () => {
    const pipeline = new SavePipeline(createEchoWrite());
    pipeline.bumpRevision("a.md");

    await pipeline.save("a.md", () => ({ content: "saved" }));

    // Disk content is different — external tool rewrote the file
    expect(pipeline.isSelfChange("a.md", "external")).toBe(false);
  });

  it("self-change flag expires after the window", async () => {
    const pipeline = new SavePipeline(createEchoWrite());

    await pipeline.save("a.md", () => ({ content: "hello" }));

    // With a 0ms window, the flag should have already expired
    expect(pipeline.isSelfChange("a.md", "hello", 0)).toBe(false);
  });

  it("hashes disk content returned from writeFn, not the requested editor content", async () => {
    const rawDisk = "# Main\n\nNormalized on disk\n\n# End";
    const writeFn = vi.fn(async (_p: string, _snapshot: SaveSnapshot) => rawDisk);
    const pipeline = new SavePipeline(writeFn);
    pipeline.initPath("main.md", rawDisk);
    pipeline.bumpRevision("main.md");

    const editorContent = "# Main\n\nNew chapter\n\n# End";
    await pipeline.save("main.md", () => ({
      content: editorContent,
    }));

    // The saved hash should match the raw disk content, not the editor content.
    expect(pipeline.getLastSavedHash("main.md")).toBe(fnv1aHash(rawDisk));
    expect(pipeline.getLastSavedHash("main.md")).not.toBe(fnv1aHash(editorContent));

    // Self-change suppression uses disk content — the watcher sees rawDisk.
    expect(pipeline.isSelfChange("main.md", rawDisk)).toBe(true);
    // The editor content does NOT match what's on disk.
    expect(pipeline.isSelfChange("main.md", editorContent)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // initPath / clear
  // ---------------------------------------------------------------------------

  it("initPath resets revision and records content hash", () => {
    const pipeline = new SavePipeline(createEchoWrite());
    pipeline.bumpRevision("a.md");
    pipeline.bumpRevision("a.md");

    pipeline.initPath("a.md", "fresh");

    expect(pipeline.getRevision("a.md")).toBe(0);
    expect(pipeline.getLastSavedRevision("a.md")).toBe(0);
    expect(pipeline.getLastSavedHash("a.md")).toBe(fnv1aHash("fresh"));
  });

  it("clear removes all state for a path", async () => {
    const pipeline = new SavePipeline(createEchoWrite());
    pipeline.initPath("a.md", "hello");
    pipeline.bumpRevision("a.md");
    await pipeline.save("a.md", () => ({ content: "saved" }));

    pipeline.clear("a.md");

    expect(pipeline.getRevision("a.md")).toBe(0);
    expect(pipeline.getLastSavedRevision("a.md")).toBe(0);
    expect(pipeline.getLastSavedHash("a.md")).toBeUndefined();
    expect(pipeline.isSelfChange("a.md", "saved")).toBe(false);
  });

  it("clear during in-flight save invalidates the result", async () => {
    const gate = createDeferred<string>();
    const writeFn = vi.fn(async (_p: string, snapshot: SaveSnapshot) => {
      await gate.promise;
      return snapshot.content;
    });
    const pipeline = new SavePipeline(writeFn);
    pipeline.initPath("a.md", "A");
    pipeline.bumpRevision("a.md");

    // Start save — held open by the gate
    const savePromise = pipeline.save("a.md", () => ({
      content: "Y",
    }));

    // User discards/switches while save is in flight
    pipeline.clear("a.md");

    // Release the write
    gate.resolve("");
    const result = await savePromise;

    // Save is reported as not saved — caller won't apply stale state
    expect(result.saved).toBe(false);

    // Pipeline state is clean — no stale bookkeeping left behind
    expect(pipeline.getLastSavedRevision("a.md")).toBe(0);
    expect(pipeline.getLastSavedHash("a.md")).toBeUndefined();
    expect(pipeline.isSaving("a.md")).toBe(false);
  });

  it("initPath during in-flight save invalidates the result", async () => {
    const gate = createDeferred<string>();
    const writeFn = vi.fn(async (_p: string, snapshot: SaveSnapshot) => {
      await gate.promise;
      return snapshot.content;
    });
    const pipeline = new SavePipeline(writeFn);
    pipeline.initPath("a.md", "A");
    pipeline.bumpRevision("a.md");

    const savePromise = pipeline.save("a.md", () => ({
      content: "Y",
    }));

    // File is reloaded while save is in flight
    pipeline.initPath("a.md", "reloaded");

    gate.resolve("");
    const result = await savePromise;

    expect(result.saved).toBe(false);
    // initPath's state should be intact, not overwritten by the stale save
    expect(pipeline.getLastSavedRevision("a.md")).toBe(0);
    expect(pipeline.getLastSavedHash("a.md")).toBe(fnv1aHash("reloaded"));
  });

  // ---------------------------------------------------------------------------
  // isSaving
  // ---------------------------------------------------------------------------

  it("isSaving reflects in-flight state", async () => {
    const gate = createDeferred();
    const pipeline = new SavePipeline(vi.fn(async (_p: string, snapshot: SaveSnapshot) => {
      await gate.promise;
      return snapshot.content;
    }));

    expect(pipeline.isSaving("a.md")).toBe(false);

    const savePromise = pipeline.save("a.md", () => ({
      content: "hello",
    }));

    expect(pipeline.isSaving("a.md")).toBe(true);

    gate.resolve();
    await savePromise;

    expect(pipeline.isSaving("a.md")).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // fnv1aHash
  // ---------------------------------------------------------------------------

  it("produces stable 8-char hex hashes", () => {
    const hash = fnv1aHash("hello");
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1aHash("hello")).toBe(hash);
    expect(fnv1aHash("world")).not.toBe(hash);
  });
});
