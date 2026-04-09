import { openRegressionDocument, settleEditorLayout } from "../test-helpers.mjs";

export const name = "debug-lane-button";

export async function run(page) {
  await openRegressionDocument(page, "index.md");
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  const button = page.getByTestId("debug-lane-button");
  const initialState = await page.evaluate(() => ({
    enabled: window.__cmDebug?.debugLaneEnabled?.() ?? false,
    panelVisible: Boolean(document.querySelector(".cf-debug-panel")),
    pressed: document.querySelector('[data-testid="debug-lane-button"]')?.getAttribute("aria-pressed"),
  }));

  if (!initialState.enabled || !initialState.panelVisible || initialState.pressed !== "true") {
    return {
      pass: false,
      message: "debug lane was not enabled by default in dev/test mode",
    };
  }

  await button.click();
  await page.waitForFunction(() => (
    !document.querySelector(".cf-debug-panel")
      && !window.__cmDebug?.debugLaneEnabled?.()
  ));

  const disabledState = await page.evaluate(() => ({
    enabled: window.__cmDebug?.debugLaneEnabled?.() ?? false,
    panelVisible: Boolean(document.querySelector(".cf-debug-panel")),
    pressed: document.querySelector('[data-testid="debug-lane-button"]')?.getAttribute("aria-pressed"),
  }));

  if (disabledState.enabled || disabledState.panelVisible || disabledState.pressed !== "false") {
    return {
      pass: false,
      message: "debug lane did not disable from the status-bar button",
    };
  }

  await button.click();
  await page.waitForFunction(() => (
    Boolean(document.querySelector(".cf-debug-panel"))
      && Boolean(window.__cmDebug?.debugLaneEnabled?.())
  ));

  const reenabledState = await page.evaluate(() => ({
    enabled: window.__cmDebug?.debugLaneEnabled?.() ?? false,
    panelVisible: Boolean(document.querySelector(".cf-debug-panel")),
    pressed: document.querySelector('[data-testid="debug-lane-button"]')?.getAttribute("aria-pressed"),
  }));

  if (!reenabledState.enabled || !reenabledState.panelVisible || reenabledState.pressed !== "true") {
    return {
      pass: false,
      message: "debug lane did not re-enable from the status-bar button",
    };
  }

  return {
    pass: true,
    message: "debug lane defaults on and the status-bar button toggles it",
  };
}
