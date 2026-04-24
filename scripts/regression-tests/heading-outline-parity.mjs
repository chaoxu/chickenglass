import {
  openFixtureDocument,
  settleEditorLayout,
  showSidebarPanel,
  switchToMode,
  waitForRenderReady,
} from "../test-helpers.mjs";

export const name = "heading-outline-parity";

const INITIAL_DOC = [
  "# Alpha {#sec:alpha}",
  "",
  "Opening paragraph.",
  "",
  "## Beta",
  "",
  "Body text.",
  "",
  "### Gamma",
  "",
  "More body text.",
  "",
  "## Aside {-}",
  "",
  "Unnumbered material.",
  "",
  "# Delta",
  "",
  "## Tail",
  "",
].join("\n");

const AFTER_CM6_DOC = INITIAL_DOC.replace("## Beta", "## Beta Revised");
const AFTER_LEXICAL_DOC = AFTER_CM6_DOC.replace("### Gamma", "### Gamma Revised");

const FIXTURE = {
  content: INITIAL_DOC,
  displayPath: "fixture:heading-outline-parity.md",
  virtualPath: "heading-outline-parity.md",
};

const EXPECTED_INITIAL = [
  { level: 1, number: "1", text: "Alpha" },
  { level: 2, number: "1.1", text: "Beta" },
  { level: 3, number: "1.1.1", text: "Gamma" },
  { level: 2, number: "", text: "Aside" },
  { level: 1, number: "2", text: "Delta" },
  { level: 2, number: "2.1", text: "Tail" },
];

const EXPECTED_AFTER_CM6 = EXPECTED_INITIAL.map((heading) =>
  heading.text === "Beta" ? { ...heading, text: "Beta Revised" } : heading
);

const EXPECTED_AFTER_LEXICAL = EXPECTED_AFTER_CM6.map((heading) =>
  heading.text === "Gamma" ? { ...heading, text: "Gamma Revised" } : heading
);

function assertDeepEqual(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    return null;
  }
  return `${label} mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
}

function comparableStyles(styles) {
  return styles.map(({ level, style }) => ({
    level,
    color: style.color,
    fontSize: style.fontSize,
    fontStyle: style.fontStyle,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
  }));
}

function assertStyleParity(cm6, lexical, label) {
  return assertDeepEqual(
    comparableStyles(lexical.headingStyles),
    comparableStyles(cm6.headingStyles),
    `${label} heading style`,
  );
}

async function waitForOutlineText(page, text) {
  await page.waitForFunction(
    (needle) => {
      const panel = document.querySelector('[data-sidebar] [role="tabpanel"][data-state="active"]');
      return panel?.innerText?.includes(needle) ?? false;
    },
    text,
    { timeout: 5_000, polling: 100 },
  );
}

async function waitForOutlineCount(page, count) {
  await page.waitForFunction(
    (expectedCount) => {
      const panel = document.querySelector('[data-sidebar] [role="tabpanel"][data-state="active"]');
      if (!panel) return false;
      return panel.querySelectorAll("button:not([aria-label])").length >= expectedCount;
    },
    count,
    { timeout: 5_000, polling: 100 },
  );
}

async function setDocument(page, doc, outlineNeedle) {
  await page.evaluate((nextDoc) => {
    const editor = window.__editor;
    if (!editor?.setDoc) {
      throw new Error("window.__editor.setDoc is unavailable");
    }
    editor.setDoc(nextDoc);
  }, doc);
  await waitForRenderReady(page, { frameCount: 3, delayMs: 64 });
  await waitForOutlineText(page, outlineNeedle);
}

async function collectSnapshot(page, mode) {
  await switchToMode(page, mode);
  await showSidebarPanel(page, "outline");
  await waitForRenderReady(page, {
    selector: mode === "lexical" ? ".cf-lexical-heading" : "[data-section-number]",
    frameCount: 3,
    delayMs: 64,
  });
  await waitForOutlineCount(page, EXPECTED_INITIAL.length);

  return page.evaluate((expectedMode) => {
    const normalize = (text) => text.replace(/\s+/g, " ").trim();
    const cleanHeadingText = (text) =>
      normalize(text)
        .replace(/^[\u25b6\u25bc]\s*/, "")
        .replace(/^#{1,6}\s+/, "")
        .replace(/\s+\{[^}]+\}$/, "");
    const levelFromClass = (element) => {
      const match = [...element.classList]
        .join(" ")
        .match(/cf-doc-heading--h([1-6])/);
      return match ? Number(match[1]) : null;
    };
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const headingSelector = expectedMode === "lexical"
      ? ".cf-doc-flow--lexical .cf-doc-heading"
      : ".cf-doc-flow--cm6 .cf-doc-heading";
    const headings = [...document.querySelectorAll(headingSelector)]
      .filter((element) => element instanceof HTMLElement && visible(element))
      .map((element) => ({
        level: levelFromClass(element),
        number:
          element.getAttribute("data-section-number") ??
          element.getAttribute("data-coflat-heading-number") ??
          "",
        text: cleanHeadingText(element.innerText),
      }));

    const headingStyles = [...document.querySelectorAll(headingSelector)]
      .filter((element) => element instanceof HTMLElement && visible(element))
      .map((element) => {
        const style = getComputedStyle(element);
        return {
          level: levelFromClass(element),
          style: {
            color: style.color,
            fontSize: style.fontSize,
            fontStyle: style.fontStyle,
            fontWeight: style.fontWeight,
            lineHeight: style.lineHeight,
          },
        };
      });

    const panel = document.querySelector('[data-sidebar] [role="tabpanel"][data-state="active"]');
    const outline = panel
      ? [...panel.querySelectorAll("button:not([aria-label])")]
        .map((button) => {
          const spans = [...button.querySelectorAll("span")];
          return {
            number: normalize(spans[0]?.textContent ?? ""),
            text: normalize(spans.at(-1)?.textContent ?? button.textContent ?? ""),
          };
        })
        .filter((entry) => entry.number || entry.text)
      : [];

    return {
      appMode: window.__app?.getMode?.() ?? null,
      headings,
      headingStyles,
      outline,
    };
  }, mode);
}

function expectedOutline(headings) {
  return headings.map(({ number, text }) => ({ number, text }));
}

function assertSnapshot(snapshot, expected, label) {
  const expectedHeadings = expected.map((heading) => ({
    level: heading.level,
    number: heading.number,
    text: heading.text,
  }));
  return (
    assertDeepEqual(snapshot.headings, expectedHeadings, `${label} headings`) ??
    assertDeepEqual(snapshot.outline, expectedOutline(expected), `${label} outline`)
  );
}

function assertParity(cm6, lexical, label) {
  return (
    assertDeepEqual(lexical.headings, cm6.headings, `${label} heading parity`) ??
    assertDeepEqual(lexical.outline, cm6.outline, `${label} outline parity`) ??
    assertStyleParity(cm6, lexical, label)
  );
}

export async function run(page) {
  await openFixtureDocument(page, FIXTURE, {
    mode: "cm6-rich",
    project: "single-file",
  });

  const cm6Initial = await collectSnapshot(page, "cm6-rich");
  const lexicalInitial = await collectSnapshot(page, "lexical");
  let error =
    assertSnapshot(cm6Initial, EXPECTED_INITIAL, "initial CM6") ??
    assertSnapshot(lexicalInitial, EXPECTED_INITIAL, "initial Lexical") ??
    assertParity(cm6Initial, lexicalInitial, "initial");
  if (error) {
    return { pass: false, message: error };
  }

  await switchToMode(page, "cm6-rich");
  await showSidebarPanel(page, "outline");
  await setDocument(page, AFTER_CM6_DOC, "Beta Revised");
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  const cm6AfterUpdate = await collectSnapshot(page, "cm6-rich");
  const lexicalAfterCm6Update = await collectSnapshot(page, "lexical");
  error =
    assertSnapshot(cm6AfterUpdate, EXPECTED_AFTER_CM6, "after CM6 update") ??
    assertSnapshot(lexicalAfterCm6Update, EXPECTED_AFTER_CM6, "Lexical after CM6 update") ??
    assertParity(cm6AfterUpdate, lexicalAfterCm6Update, "after CM6 update");
  if (error) {
    return { pass: false, message: error };
  }

  await setDocument(page, AFTER_LEXICAL_DOC, "Gamma Revised");
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  const lexicalAfterUpdate = await collectSnapshot(page, "lexical");
  const cm6AfterLexicalUpdate = await collectSnapshot(page, "cm6-rich");
  error =
    assertSnapshot(lexicalAfterUpdate, EXPECTED_AFTER_LEXICAL, "after Lexical update") ??
    assertSnapshot(cm6AfterLexicalUpdate, EXPECTED_AFTER_LEXICAL, "CM6 after Lexical update") ??
    assertParity(cm6AfterLexicalUpdate, lexicalAfterUpdate, "after Lexical update");
  if (error) {
    return { pass: false, message: error };
  }

  return {
    pass: true,
    message:
      `${cm6AfterLexicalUpdate.headings.length} headings and ` +
      `${cm6AfterLexicalUpdate.outline.length} outline entries match across CM6/Lexical`,
  };
}
