import { describe, expect, it, vi } from "vitest";

import {
  measureEditorBridgeTypingLatency,
  summarizeDurations,
} from "./typing-latency-helpers.mjs";

describe("typing latency helpers", () => {
  it("summarizes duration samples deterministically", () => {
    expect(summarizeDurations([4, 1, 2, Number.NaN, 10])).toEqual({
      maxMs: 10,
      meanMs: 4.25,
      p95Ms: 10,
      samples: 4,
    });
  });

  it("measures editor bridge typing through a page evaluate probe", async () => {
    let doc = "alpha target omega";
    let selection = 0;
    globalThis.window ??= {};
    globalThis.requestAnimationFrame ??= (callback) => setTimeout(() => callback(performance.now()), 0);
    window.requestIdleCallback = (callback) => setTimeout(callback, 0);
    window.__editor = {
      focus: vi.fn(),
      getDoc: () => doc,
      insertText: (text) => {
        doc = `${doc.slice(0, selection)}${text}${doc.slice(selection)}`;
        selection += text.length;
      },
      ready: Promise.resolve(),
      setSelection: (anchor) => {
        selection = anchor;
      },
    };
    const page = {
      evaluate: vi.fn(async (fn, arg) => fn(arg)),
    };

    const result = await measureEditorBridgeTypingLatency(page, {
      anchorNeedle: "target",
      insertText: "12",
    });

    expect(doc).toContain("target12");
    expect(result.insertCount).toBe(2);
    expect(result.docLength).toBe(doc.length);
  });
});
