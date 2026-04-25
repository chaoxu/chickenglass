import { describe, expect, it } from "vitest";
import {
  DEFAULT_RUNTIME_BUDGET_PROFILE,
  formatRuntimeBudgetProfileDefaults,
  HEAVY_DOC_RUNTIME_BUDGET_PROFILE,
  RUNTIME_BUDGET_PROFILES,
  runtimeBudgetProfileForMode,
} from "./runtime-budget-profiles.mjs";

describe("runtime budget profiles", () => {
  it("defines the default browser/perf automation profile", () => {
    expect(DEFAULT_RUNTIME_BUDGET_PROFILE).toEqual({
      name: "default",
      debugBridgeTimeoutMs: 15_000,
      fixtureOpenTimeoutMs: 10_000,
      postOpenSettleMs: 200,
      pollIntervalMs: 25,
      idleSettleTimeoutMs: 1_000,
      documentStableTimeoutMs: 5_000,
      sidebarReadyTimeoutMs: 5_000,
      sidebarPanelPublishTimeoutMs: 5_000,
      typingCanonicalTimeoutMs: 5_000,
      typingVisualSyncTimeoutMs: 3_000,
      typingSemanticTimeoutMs: 3_000,
    });
    expect(RUNTIME_BUDGET_PROFILES.default).toBe(DEFAULT_RUNTIME_BUDGET_PROFILE);
    expect(runtimeBudgetProfileForMode()).toBe(DEFAULT_RUNTIME_BUDGET_PROFILE);
  });

  it("defines the heavy-doc browser/perf automation profile", () => {
    expect(HEAVY_DOC_RUNTIME_BUDGET_PROFILE).toEqual({
      name: "heavy-doc",
      debugBridgeTimeoutMs: 45_000,
      fixtureOpenTimeoutMs: 45_000,
      postOpenSettleMs: 800,
      pollIntervalMs: 50,
      idleSettleTimeoutMs: 5_000,
      documentStableTimeoutMs: 15_000,
      sidebarReadyTimeoutMs: 15_000,
      sidebarPanelPublishTimeoutMs: 15_000,
      typingCanonicalTimeoutMs: 15_000,
      typingVisualSyncTimeoutMs: 10_000,
      typingSemanticTimeoutMs: 10_000,
    });
    expect(RUNTIME_BUDGET_PROFILES["heavy-doc"]).toBe(HEAVY_DOC_RUNTIME_BUDGET_PROFILE);
    expect(runtimeBudgetProfileForMode({ heavyDoc: true })).toBe(
      HEAVY_DOC_RUNTIME_BUDGET_PROFILE,
    );
  });

  it("formats profile values for CLI help and docs", () => {
    expect(formatRuntimeBudgetProfileDefaults(DEFAULT_RUNTIME_BUDGET_PROFILE)).toBe(
      "debug=15000ms, open=10000ms, post-open-settle=200ms, poll=25ms, idle=1000ms",
    );
  });
});
