import { describe, expect, it, vi } from "vitest";

import { measureCm6TypingBurst } from "./typing-burst-helpers.mjs";

describe("typing burst helpers", () => {
  it("measures a CM6 typing burst through the shared page helper", async () => {
    let anchor = 0;
    globalThis.window ??= {};
    globalThis.requestAnimationFrame ??= (callback) =>
      setTimeout(() => callback(performance.now()), 0);
    window.requestIdleCallback = (callback) => setTimeout(callback, 0);
    window.__cmView = {
      focus: vi.fn(),
      state: {
        get selection() {
          return { main: { anchor } };
        },
      },
      dispatch: vi.fn((transaction) => {
        anchor = transaction.selection?.anchor ?? anchor;
      }),
    };
    const page = {
      evaluate: vi.fn(async (fn, arg) => fn(arg)),
    };

    const result = await measureCm6TypingBurst(page, 3, 2, {
      idleSettleTimeoutMs: 50,
    });

    expect(result.insertCount).toBe(2);
    expect(result.longTaskSupported).toBe(0);
    expect(window.__cmView.dispatch).toHaveBeenCalled();
  });
});
