import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useUnsavedChangesDialog } from "./use-unsaved-changes-dialog";
import type { UnsavedChangesRequest } from "../unsaved-changes";

function createRequest(name: string): UnsavedChangesRequest {
  return {
    reason: "switch-file",
    currentDocument: {
      path: "current.md",
      name: "current.md",
    },
    target: {
      path: `${name}.md`,
      name: `${name}.md`,
    },
  };
}

describe("useUnsavedChangesDialog", () => {
  it("tracks the pending and resolved states for a single request", async () => {
    const { result } = renderHook(() => useUnsavedChangesDialog());
    const request = createRequest("next");

    let decisionPromise: Promise<"save" | "discard" | "cancel">;
    await act(async () => {
      decisionPromise = result.current.requestDecision(request);
      await Promise.resolve();
    });

    expect(result.current.status).toBe("pending");
    expect(result.current.request).toEqual(request);
    expect(result.current.suspensionVersion).toBe(1);

    let decision: "save" | "discard" | "cancel";
    await act(async () => {
      result.current.resolveDecision("save");
      decision = await decisionPromise;
    });

    expect(decision!).toBe("save");
    expect(result.current.status).toBe("resolved");
    expect(result.current.request).toBeNull();
    expect(result.current.suspensionVersion).toBe(2);
  });

  it("cancels the previous request when a new one replaces it", async () => {
    const { result } = renderHook(() => useUnsavedChangesDialog());
    const first = createRequest("first");
    const second = createRequest("second");

    let firstDecision: Promise<"save" | "discard" | "cancel">;
    await act(async () => {
      firstDecision = result.current.requestDecision(first);
      await Promise.resolve();
    });

    let secondDecision: Promise<"save" | "discard" | "cancel">;
    await act(async () => {
      secondDecision = result.current.requestDecision(second);
      await Promise.resolve();
    });

    await expect(firstDecision!).resolves.toBe("cancel");
    expect(result.current.status).toBe("pending");
    expect(result.current.request).toEqual(second);
    expect(result.current.suspensionVersion).toBe(3);

    let finalDecision: "save" | "discard" | "cancel";
    await act(async () => {
      result.current.resolveDecision("discard");
      finalDecision = await secondDecision;
    });

    expect(finalDecision!).toBe("discard");
    expect(result.current.status).toBe("resolved");
    expect(result.current.request).toBeNull();
    expect(result.current.suspensionVersion).toBe(4);
  });

  it("cancels the pending request when the hook unmounts", async () => {
    const { result, unmount } = renderHook(() => useUnsavedChangesDialog());

    let decisionPromise: Promise<"save" | "discard" | "cancel">;
    await act(async () => {
      decisionPromise = result.current.requestDecision(createRequest("next"));
      await Promise.resolve();
    });

    unmount();

    await expect(decisionPromise!).resolves.toBe("cancel");
  });
});
