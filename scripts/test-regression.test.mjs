import { EventEmitter } from "node:events";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MissingFixtureError } from "./fixture-test-helpers.mjs";
import { runRegressionTestWithChecks } from "./regression-runner-checks.mjs";
import { shouldSkipMissingFixture } from "./test-regression.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

describe("browser regression missing fixture policy", () => {
  it("fails missing fixtures by default", () => {
    const error = new MissingFixtureError("Missing fixture for fixtures/private.md. Tried: /tmp/missing");

    expect(shouldSkipMissingFixture(error, { name: "private-heavy" })).toBe(false);
  });

  it("allows explicit optional fixture skips", () => {
    const error = new MissingFixtureError("Missing fixture for fixtures/private.md. Tried: /tmp/missing");

    expect(shouldSkipMissingFixture(error, {
      name: "private-heavy",
      optionalFixtures: true,
    })).toBe(true);
    expect(shouldSkipMissingFixture(error, { name: "private-heavy" }, {
      allowMissingFixtures: true,
    })).toBe(true);
  });

  it("marks private-fixture browser regressions as optional or gives them public fallbacks", () => {
    const regressionDir = join(__dirname, "regression-tests");
    const privateMarkers = [
      "cogirth/",
      "rankdecrease/",
      "RANKDECREASE_MAIN_FIXTURE",
      "COGIRTH_MAIN2_FIXTURE",
    ];
    const privateFixtureFiles = readdirSync(regressionDir)
      .filter((file) => file.endsWith(".mjs"))
      .filter((file) => {
        const content = readFileSync(join(regressionDir, file), "utf8");
        return privateMarkers.some((marker) => content.includes(marker));
      });

    expect(privateFixtureFiles).not.toEqual([]);
    for (const file of privateFixtureFiles) {
      const content = readFileSync(join(regressionDir, file), "utf8");
      const hasOptionalFixtureSkip = content.includes("export const optionalFixtures = true");
      const hasGeneratedPublicFallback =
        content.includes("resolveFixtureDocumentWithFallback") &&
        content.includes("PUBLIC_SCROLL_STRESS_FIXTURE");
      expect(
        hasOptionalFixtureSkip || hasGeneratedPublicFallback,
        file,
      ).toBe(true);
    }
  });
});
