import { describe, expect, it, vi } from "vitest";

import { readLocalStorage, writeLocalStorage } from "./utils";

describe("localStorage helpers", () => {
  it("logs corrupt stored JSON before returning the fallback", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem("coflat:test", "{not json");

    expect(readLocalStorage("coflat:test", "fallback")).toBe("fallback");
    expect(consoleError).toHaveBeenCalledWith(
      "[storage] failed to read localStorage key",
      "coflat:test",
      expect.any(SyntaxError),
    );

    consoleError.mockRestore();
  });

  it("logs storage write failures", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("quota");
    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw error;
    });

    writeLocalStorage("coflat:test", { ok: true });

    expect(consoleError).toHaveBeenCalledWith(
      "[storage] failed to write localStorage key",
      "coflat:test",
      error,
    );

    setItem.mockRestore();
    consoleError.mockRestore();
  });
});
