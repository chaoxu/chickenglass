import { describe, expect, it } from "vitest";

import {
  getCommittedModeOverride,
  getPendingModeOverride,
  initialEditorModeOverrideState,
  transitionEditorModeOverride,
} from "./editor-mode-override-state";

describe("editor mode override state", () => {
  it("lets a pending request override an older committed mode for the same path", () => {
    const committed = transitionEditorModeOverride(
      initialEditorModeOverrideState,
      {
        type: "commit",
        target: { path: "notes.md", mode: "source" },
      },
    );

    const pending = transitionEditorModeOverride(committed, {
      type: "begin",
      requestId: 1,
      target: { path: "notes.md", mode: "source" },
    });

    expect(getCommittedModeOverride(pending, "notes.md")).toBe("source");
    expect(getPendingModeOverride(pending, "notes.md")).toBe("source");
  });

  it("does not let an older request clear or commit a newer pending request", () => {
    const firstPending = transitionEditorModeOverride(
      initialEditorModeOverrideState,
      {
        type: "begin",
        requestId: 1,
        target: { path: "notes.md", mode: "source" },
      },
    );
    const secondPending = transitionEditorModeOverride(firstPending, {
      type: "begin",
      requestId: 2,
      target: { path: "notes.md", mode: "source" },
    });

    const staleCleared = transitionEditorModeOverride(secondPending, {
      type: "clear-pending",
      requestId: 1,
    });
    const staleCommitted = transitionEditorModeOverride(staleCleared, {
      type: "commit",
      requestId: 1,
      target: { path: "notes.md", mode: "source" },
    });

    expect(staleCommitted).toBe(staleCleared);
    expect(getPendingModeOverride(staleCommitted, "notes.md")).toBe("source");
    expect(getCommittedModeOverride(staleCommitted, "notes.md")).toBeUndefined();
  });

  it("commits only the matching pending request", () => {
    const pending = transitionEditorModeOverride(
      initialEditorModeOverrideState,
      {
        type: "begin",
        requestId: 5,
        target: { path: "paper.md", mode: "source" },
      },
    );

    const committed = transitionEditorModeOverride(pending, {
      type: "commit",
      requestId: 5,
      target: { path: "paper.md", mode: "source" },
    });

    expect(getPendingModeOverride(committed, "paper.md")).toBeUndefined();
    expect(getCommittedModeOverride(committed, "paper.md")).toBe("source");
  });
});
