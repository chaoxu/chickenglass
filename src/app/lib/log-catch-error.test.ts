import { afterEach, describe, expect, it, vi } from "vitest";
import { logCatchError } from "./log-catch-error";

describe("logCatchError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs the context and error when no extra details are provided", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("boom");

    logCatchError("[perf] failed to load snapshot")(error);

    expect(consoleError).toHaveBeenCalledWith("[perf] failed to load snapshot", error);
  });

  it("logs contextual details before the error", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("boom");
    const payload = { path: "notes/doc.md", treeChanged: true };

    logCatchError("[file-watcher] handleFileChanged failed", payload, "notes/doc.md")(error);

    expect(consoleError).toHaveBeenCalledWith(
      "[file-watcher] handleFileChanged failed",
      payload,
      "notes/doc.md",
      error,
    );
  });
});
