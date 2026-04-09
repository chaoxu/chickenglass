import { afterEach, describe, expect, it, vi } from "vitest";

async function loadWarnOnce() {
  vi.resetModules();
  return import("./warn-once");
}

describe("warnOnce", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("logs only once per key", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { warnOnce } = await loadWarnOnce();

    warnOnce("warn-once:test:key", "hello", { attempt: 1 });
    warnOnce("warn-once:test:key", "hello", { attempt: 2 });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith("hello", { attempt: 1 });
  });

  it("clears the cache after reaching the key cap", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { warnOnce } = await loadWarnOnce();
    const prefix = "warn-once:test:cap";

    warnOnce(`${prefix}:first`, "first");
    for (let i = 0; i < 199; i += 1) {
      warnOnce(`${prefix}:fill:${i}`, "fill", i);
    }

    warnOnce(`${prefix}:overflow`, "overflow");
    warnOnce(`${prefix}:first`, "first again");

    expect(warnSpy).toHaveBeenCalledTimes(202);
    expect(warnSpy.mock.calls[0]).toEqual(["first"]);
    expect(warnSpy.mock.calls.at(-1)).toEqual(["first again"]);
  });
});
