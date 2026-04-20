import { describe, expect, it } from "vitest";

import {
  activateCursorReveal,
  beginCursorRevealClose,
  beginCursorRevealCommit,
  clearClosedCursorReveal,
  clearCursorRevealUserIntent,
  closeCursorReveal,
  consumeCursorRevealUserIntent,
  createCursorRevealIdle,
  finishCursorRevealClose,
  getCursorRevealSession,
  isCursorRevealOpening,
  markCursorRevealUserIntent,
  openCursorReveal,
  shouldSuppressCursorRevealOpen,
} from "./cursor-reveal-machine";

describe("cursor reveal machine", () => {
  it("models opening, editing, committing, and closing transitions explicitly", () => {
    const idle = createCursorRevealIdle<{ readonly key: string }>();
    expect(getCursorRevealSession(idle)).toBeNull();

    const opening = openCursorReveal({ key: "a" }, "opening");
    expect(isCursorRevealOpening(opening)).toBe(true);
    expect(getCursorRevealSession(opening)).toEqual({ key: "a" });

    const editing = activateCursorReveal(opening);
    expect(isCursorRevealOpening(editing)).toBe(false);
    expect(getCursorRevealSession(editing)).toEqual({ key: "a" });

    const committing = beginCursorRevealCommit(editing);
    expect(getCursorRevealSession(committing)).toEqual({ key: "a" });

    const closing = beginCursorRevealClose(committing, "node-a");
    expect(getCursorRevealSession(closing)).toBeNull();
    expect(finishCursorRevealClose(closing)).toEqual(closeCursorReveal(editing, "node-a"));

    const closed = finishCursorRevealClose(closing);
    expect(getCursorRevealSession(closed)).toBeNull();
    expect(shouldSuppressCursorRevealOpen(closed, "node-a")).toBe(true);
    expect(shouldSuppressCursorRevealOpen(closed, "node-b")).toBe(false);
    expect(shouldSuppressCursorRevealOpen(clearClosedCursorReveal(closed), "node-a")).toBe(false);
  });

  it("owns user-driven reveal intent instead of storing it in a side ref", () => {
    const idle = createCursorRevealIdle();
    const missing = consumeCursorRevealUserIntent(idle, true);
    expect(missing.allowed).toBe(false);

    const marked = markCursorRevealUserIntent(missing.state);
    const optional = consumeCursorRevealUserIntent(marked, false);
    expect(optional.allowed).toBe(true);
    expect(consumeCursorRevealUserIntent(optional.state, true).allowed).toBe(false);

    const consumed = consumeCursorRevealUserIntent(
      clearCursorRevealUserIntent(markCursorRevealUserIntent(optional.state)),
      true,
    );
    expect(consumed.allowed).toBe(false);

    const allowed = consumeCursorRevealUserIntent(markCursorRevealUserIntent(consumed.state), true);
    expect(allowed.allowed).toBe(true);
    expect(consumeCursorRevealUserIntent(allowed.state, true).allowed).toBe(false);
  });
});
