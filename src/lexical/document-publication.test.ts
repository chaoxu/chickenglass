import { describe, expect, it, vi } from "vitest";

import {
  publishLexicalDocumentChanges,
  publishLexicalDocumentSnapshot,
} from "./document-publication";

function createTarget(doc: string) {
  return {
    lastCommittedDocRef: { current: doc },
    onDocChange: vi.fn(),
    onTextChange: vi.fn(),
    pendingLocalEchoDocRef: { current: null as string | null },
    userEditPendingRef: { current: true },
  };
}

describe("document publication", () => {
  it("publishes snapshots with one ref/callback transition", () => {
    const target = createTarget("Alpha");

    const result = publishLexicalDocumentSnapshot(target, "Alpha Beta");

    expect(result.changed).toBe(true);
    expect(target.pendingLocalEchoDocRef.current).toBe("Alpha Beta");
    expect(target.lastCommittedDocRef.current).toBe("Alpha Beta");
    expect(target.userEditPendingRef.current).toBe(false);
    expect(target.onTextChange).toHaveBeenCalledWith("Alpha Beta");
    expect(target.onDocChange).toHaveBeenCalledWith([{
      from: 5,
      insert: " Beta",
      to: 5,
    }]);
  });

  it("publishes explicit changes through the same callback order", () => {
    const target = createTarget("Alpha");

    const result = publishLexicalDocumentChanges(target, [{
      from: 5,
      insert: " Beta",
      to: 5,
    }]);

    expect(result.changed).toBe(true);
    expect(target.pendingLocalEchoDocRef.current).toBe("Alpha Beta");
    expect(target.lastCommittedDocRef.current).toBe("Alpha Beta");
    expect(target.userEditPendingRef.current).toBe(false);
    expect(target.onTextChange.mock.invocationCallOrder[0]).toBeLessThan(
      target.onDocChange.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("clears user edit state without fan-out for unchanged snapshots", () => {
    const target = createTarget("Alpha");

    const result = publishLexicalDocumentSnapshot(target, "Alpha");

    expect(result.changed).toBe(false);
    expect(target.lastCommittedDocRef.current).toBe("Alpha");
    expect(target.pendingLocalEchoDocRef.current).toBeNull();
    expect(target.userEditPendingRef.current).toBe(false);
    expect(target.onTextChange).not.toHaveBeenCalled();
    expect(target.onDocChange).not.toHaveBeenCalled();
  });
});
