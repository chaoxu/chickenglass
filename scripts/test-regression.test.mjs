import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { runRegressionTestWithChecks } from "./regression-runner-checks.mjs";

class FakePage extends EventEmitter {
  off(event, listener) {
    this.removeListener(event, listener);
    return this;
  }
}

function consoleError(text) {
  return {
    type: () => "error",
    text: () => text,
  };
}

describe("browser regression runner checks", () => {
  it("fails a passing regression when it emits console errors", async () => {
    const page = new FakePage();
    const result = await runRegressionTestWithChecks(page, {
      name: "sentinel-console-error",
      editorHealth: false,
      run: async () => {
        page.emit("console", consoleError("sentinel runtime error"));
        return { pass: true, message: "looked fine" };
      },
    });

    expect(result).toEqual({
      pass: false,
      message: "runtime issues: [console] sentinel runtime error",
    });
  });

  it("does not fail skipped regressions for runtime noise", async () => {
    const page = new FakePage();
    const result = await runRegressionTestWithChecks(page, {
      name: "skipped-noisy",
      run: async () => {
        page.emit("console", consoleError("known noisy skipped test"));
        return { pass: true, skipped: true, message: "not applicable" };
      },
    });

    expect(result).toEqual({
      pass: true,
      skipped: true,
      message: "not applicable",
    });
  });
});
