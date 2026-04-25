export const RUNTIME_BUDGET_PROFILE_NAMES = Object.freeze({
  default: "default",
  heavyDoc: "heavy-doc",
});

export const DEFAULT_RUNTIME_BUDGET_PROFILE = Object.freeze({
  name: RUNTIME_BUDGET_PROFILE_NAMES.default,
  debugBridgeTimeoutMs: 15_000,
  fixtureOpenTimeoutMs: 10_000,
  postOpenSettleMs: 200,
  idleSettleTimeoutMs: 1_000,
  sidebarPanelPublishTimeoutMs: 5_000,
});

export const HEAVY_DOC_RUNTIME_BUDGET_PROFILE = Object.freeze({
  name: RUNTIME_BUDGET_PROFILE_NAMES.heavyDoc,
  debugBridgeTimeoutMs: 45_000,
  fixtureOpenTimeoutMs: 45_000,
  postOpenSettleMs: 800,
  idleSettleTimeoutMs: 5_000,
  sidebarPanelPublishTimeoutMs: 15_000,
});

export const RUNTIME_BUDGET_PROFILES = Object.freeze({
  [DEFAULT_RUNTIME_BUDGET_PROFILE.name]: DEFAULT_RUNTIME_BUDGET_PROFILE,
  [HEAVY_DOC_RUNTIME_BUDGET_PROFILE.name]: HEAVY_DOC_RUNTIME_BUDGET_PROFILE,
});

export function runtimeBudgetProfileForMode({ heavyDoc = false } = {}) {
  return heavyDoc
    ? HEAVY_DOC_RUNTIME_BUDGET_PROFILE
    : DEFAULT_RUNTIME_BUDGET_PROFILE;
}

export function formatRuntimeBudgetProfileDefaults(profile) {
  return [
    `debug=${profile.debugBridgeTimeoutMs}ms`,
    `open=${profile.fixtureOpenTimeoutMs}ms`,
    `post-open-settle=${profile.postOpenSettleMs}ms`,
  ].join(", ");
}
