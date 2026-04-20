import { describe, expect, it } from "vitest";

import {
  activateCursorReveal,
  clearClosedCursorReveal,
  closeCursorReveal,
  createCursorRevealIdle,
  getCursorRevealSession,
  isCursorRevealOpening,
  openCursorReveal,
  shouldSuppressCursorRevealOpen,
} from "./cursor-reveal-machine";

describe("cursor reveal machine", () => {
  it("models idle, opening, editing, and close transitions explicitly", () => {
    const idle = createCursorRevealIdle<{ readonly key: string }>();
    expect(getCursorRevealSession(idle)).toBeNull();

    const opening = openCursorReveal({ key: "a" }, "opening");
    expect(isCursorRevealOpening(opening)).toBe(true);
    expect(getCursorRevealSession(opening)).toEqual({ key: "a" });

    const editing = activateCursorReveal(opening);
    expect(isCursorRevealOpening(editing)).toBe(false);
    expect(getCursorRevealSession(editing)).toEqual({ key: "a" });

    const closed = closeCursorReveal(editing, "node-a");
    expect(getCursorRevealSession(closed)).toBeNull();
    expect(shouldSuppressCursorRevealOpen(closed, "node-a")).toBe(true);
    expect(shouldSuppressCursorRevealOpen(closed, "node-b")).toBe(false);
    expect(shouldSuppressCursorRevealOpen(clearClosedCursorReveal(closed), "node-a")).toBe(false);
  });
});
