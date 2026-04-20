import { describe, expect, it } from "vitest";

import {
  TOOLING_FIXTURES,
  fallbackFixtureFor,
  fixtureCoverageWarning,
  fixtureForHarness,
  fixtureStatus,
} from "./tooling-fixtures.mjs";

describe("tooling fixture catalog", () => {
  it("declares the shared perf/browser fixture defaults", () => {
    expect(fixtureForHarness("publicHeavy")).toMatchObject({
      displayPath: "demo/perf-heavy/main.md",
      virtualPath: "perf-heavy/main.md",
    });
    expect(fallbackFixtureFor("publicHeavy")).toMatchObject({
      displayPath: "demo/index.md",
      virtualPath: "index.md",
    });
    expect(fixtureForHarness("rankdecrease")).toMatchObject({
      displayPath: "fixtures/rankdecrease/main.md",
      virtualPath: "rankdecrease/main.md",
    });
    expect(fallbackFixtureFor("rankdecrease")).toMatchObject({
      displayPath: "demo/perf-heavy/main.md",
      virtualPath: "perf-heavy/main.md",
    });
    expect(TOOLING_FIXTURES.cogirthMain2.purpose).toContain("typing/perf");
  });

  it("formats missing-fixture warnings with purpose, fallback, and candidates", () => {
    const warning = fixtureCoverageWarning("publicHeavy", "publicShowcase");

    expect(warning).toContain("public redacted heavy scroll/perf fixture");
    expect(warning).toContain("demo/perf-heavy/main.md");
    expect(warning).toContain("demo/index.md");
    expect(warning).toContain("Tried:");
  });

  it("reports optional fixture status through the catalog shape", () => {
    const status = fixtureStatus("cogirthSearchModeAwareness");

    expect(status.path).toBe("fixtures/cogirth/search-mode-awareness.md");
    expect(status.purpose).toBe("search mode browser regression");
    expect(status.privacy).toBe("local");
  });
});
