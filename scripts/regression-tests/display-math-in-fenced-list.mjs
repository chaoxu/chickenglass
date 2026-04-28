import {
  getStructureState,
  openRegressionDocument,
  scrollToText,
  settleEditorLayout,
} from "../test-helpers.mjs";

export const name = "display-math-in-fenced-list";

export async function run(page) {
  await openRegressionDocument(page, "index.md");
  await scrollToText(page, "Display math in fenced div list:");
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  await page.evaluate(() => {
    const display = Array.from(
      document.querySelectorAll(".cf-math-display .cf-math-display-content"),
    ).find((el) => el.textContent?.includes("A_2") && el.textContent?.includes("TU"));
    if (!(display instanceof HTMLElement)) {
      throw new Error("fenced-div list display math content not found");
    }
    display.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
    }));
  });

  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  const [structure, state] = await Promise.all([
    getStructureState(page),
    page.evaluate(() => {
    const lineTexts = Array.from(window.__cmView.dom.querySelectorAll(".cm-line"))
      .map((el) => ({
        text: el.textContent ?? "",
        hidden: getComputedStyle(el).height === "0px",
      }))
      .filter((entry) =>
        entry.text.includes("Display math in fenced div list")
        || entry.text.includes("A_1")
        || entry.text.includes("A_2")
        || entry.text.trim() === "\\["
        || entry.text.trim() === "\\]"
        || entry.text.includes("Next item"),
      );
    return {
      lineTexts,
    };
    }),
  ]);

  if (structure?.kind !== "display-math") {
    return {
      pass: false,
      message: `expected display-math structure, got ${structure?.kind ?? "none"}`,
    };
  }

  const visibleLines = state.lineTexts.filter((entry) => !entry.hidden).map((entry) => entry.text);
  if (!visibleLines.some((text) => text.includes("A_1") || text.includes("A_2"))) {
    return {
      pass: false,
      message: "display-math source did not reveal inside the fenced-div list",
    };
  }

  return {
    pass: true,
    message: "display math reveals correctly inside a fenced-div list",
  };
}
