/**
 * Regression coverage for inline formatting (bold / italic / inline-code /
 * strikethrough / highlight) under the cursor-reveal feature.
 *
 * The default reveal presentation is INLINE — clicking inside a styled run
 * swaps the rendered span for a plain TextNode containing the raw markdown
 * source. Once the caret leaves the swapped node, the adapter re-applies the
 * styled span. The product contract this test verifies:
 *
 *   1. The token DOES reveal its raw markdown when the caret lands inside it
 *      (e.g. clicking ".cf-bold" surfaces the surrounding `**` markers).
 *   2. The reveal cycle round-trips cleanly — moving the caret away
 *      re-renders the span and the canonical markdown export still contains
 *      every formatting marker.
 */
import {
  DEBUG_EDITOR_SELECTOR,
  formatRuntimeIssues,
  openRegressionDocument,
  readEditorText,
  setRevealPresentation,
  withRuntimeIssueCapture,
} from "../test-helpers.mjs";

export const name = "inline-format-editing";
export const groups = ["reveal"];

const TOKEN_PROBES = [
  { selector: ".cf-bold", text: "Bold text", marker: "**" },
  { selector: ".cf-italic", text: "italic text", marker: "*" },
  { selector: ".cf-strikethrough", text: "strikethrough", marker: "~~" },
  { selector: ".cf-highlight", text: "highlight", marker: "==" },
  { selector: ".cf-inline-code", text: "inline code", marker: "`" },
];

async function placeCaretInsideToken(page, selector, text) {
  const token = page.locator(selector).filter({ hasText: text }).first();
  await token.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  await token.scrollIntoViewIfNeeded().catch(() => {});
  const box = await token.boundingBox();
  if (!box) {
    return false;
  }
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return true;
}

async function moveCaretToStart(page) {
  await page.evaluate((editorSelector) => {
    const root = document.querySelector(editorSelector);
    if (!(root instanceof HTMLElement)) return;
    root.focus();
    const first = root.firstChild;
    if (!first) return;
    const range = document.createRange();
    range.setStart(first, 0);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    root.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
  }, DEBUG_EDITOR_SELECTOR);
}

export async function run(page) {
  await setRevealPresentation(page, "inline");
  await openRegressionDocument(page, "index.md", { mode: "lexical" });

  const { issues, value } = await withRuntimeIssueCapture(page, async () => {
    const revealChecks = [];
    for (const probe of TOKEN_PROBES) {
      const placed = await placeCaretInsideToken(page, probe.selector, probe.text);
      const sourceNeedle = `${probe.marker}${probe.text}${probe.marker}`;
      await page.waitForFunction(
        ({ editorSelector, needle }) => (document.querySelector(editorSelector)?.textContent ?? "").includes(needle),
        { editorSelector: DEBUG_EDITOR_SELECTOR, needle: sourceNeedle },
        { timeout: 1000 },
      ).catch(() => {});
      const sawSource = await page.evaluate(({ editorSelector, needle }) => {
        const editor = document.querySelector(editorSelector);
        return (editor?.textContent ?? "").includes(needle);
      }, { editorSelector: DEBUG_EDITOR_SELECTOR, needle: sourceNeedle });
      revealChecks.push({
        marker: probe.marker,
        placed,
        sawSource,
        selector: probe.selector,
        text: probe.text,
      });
      await moveCaretToStart(page);
      await page.waitForFunction(
        ({ editorSelector, needle }) => !(document.querySelector(editorSelector)?.textContent ?? "").includes(needle),
        { editorSelector: DEBUG_EDITOR_SELECTOR, needle: sourceNeedle },
        { timeout: 1000 },
      ).catch(() => {});
    }

    const markdown = await readEditorText(page);
    return { markdown, revealChecks };
  });

  if (issues.length > 0) {
    return {
      pass: false,
      message: `runtime issues surfaced during inline-format reveal: ${formatRuntimeIssues(issues)}`,
    };
  }

  for (const check of value.revealChecks) {
    if (!check.placed) {
      return {
        pass: false,
        message: `${check.selector} (${JSON.stringify(check.text)}) was not present on the surface to click`,
      };
    }
    if (!check.sawSource) {
      return {
        pass: false,
        message: `${check.selector} did not reveal its raw markdown source on caret-in (expected ${check.marker}${check.text}${check.marker})`,
      };
    }
  }

  for (const probe of TOKEN_PROBES) {
    const expected = `${probe.marker}${probe.text}${probe.marker}`;
    if (!value.markdown.includes(expected)) {
      return {
        pass: false,
        message: `markdown export lost the ${probe.selector} formatting after the reveal cycle (missing ${expected})`,
      };
    }
  }

  return {
    pass: true,
    message: "inline format reveal surfaces raw markdown on caret-in and round-trips through canonical export",
  };
}
