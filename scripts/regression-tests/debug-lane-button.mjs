import {
  isDebugLaneEnabled,
  openRegressionDocument,
  settleEditorLayout,
} from "../test-helpers.mjs";

export const name = "debug-lane-button";

export async function run(page) {
  await openRegressionDocument(page, "index.md");
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  const button = page.getByTestId("debug-lane-button");
  const initialState = await page.evaluate((enabled) => ({
    enabled,
    panelVisible: Boolean(document.querySelector(".cf-debug-panel")),
    pressed: document.querySelector('[data-testid="debug-lane-button"]')?.getAttribute("aria-pressed"),
  }), await isDebugLaneEnabled(page));

  if (initialState.enabled || initialState.panelVisible || initialState.pressed !== "false") {
    return {
      pass: false,
      message: "debug lane should start disabled by default",
    };
  }

  await button.click();
  await page.waitForFunction(() => (
    Boolean(document.querySelector(".cf-debug-panel"))
      && document.querySelector('[data-testid="debug-lane-button"]')?.getAttribute("aria-pressed") === "true"
  ));

  const enabledState = await page.evaluate((enabled) => ({
    enabled,
    panelVisible: Boolean(document.querySelector(".cf-debug-panel")),
    pressed: document.querySelector('[data-testid="debug-lane-button"]')?.getAttribute("aria-pressed"),
  }), await isDebugLaneEnabled(page));

  if (!enabledState.enabled || !enabledState.panelVisible || enabledState.pressed !== "true") {
    return {
      pass: false,
      message: "debug lane did not enable from the status-bar button",
    };
  }

  await button.click();
  await page.waitForFunction(() => (
    !document.querySelector(".cf-debug-panel")
      && document.querySelector('[data-testid="debug-lane-button"]')?.getAttribute("aria-pressed") === "false"
  ));

  const disabledState = await page.evaluate((enabled) => ({
    enabled,
    panelVisible: Boolean(document.querySelector(".cf-debug-panel")),
    pressed: document.querySelector('[data-testid="debug-lane-button"]')?.getAttribute("aria-pressed"),
  }), await isDebugLaneEnabled(page));

  if (disabledState.enabled || disabledState.panelVisible || disabledState.pressed !== "false") {
    return {
      pass: false,
      message: "debug lane did not disable from the status-bar button",
    };
  }

  return {
    pass: true,
    message: "debug lane defaults off and the status-bar button toggles it",
  };
}
