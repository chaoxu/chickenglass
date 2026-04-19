import {
  readEditorText,
  setSelection,
  switchToMode,
  waitForBrowserSettled,
} from "../test-helpers.mjs";

export const name = "inline-token-source-offsets";

async function openScratch(page, doc, label) {
  const path = `scratch-inline-token-offsets-${label}-${Date.now()}.md`;
  await page.evaluate(async ({ path, text }) => {
    await window.__app?.closeFile?.({ discard: true });
    await window.__app.openFileWithContent(path, text);
  }, { path, text: doc });
  await page.waitForFunction(
    ({ expectedPath, text }) =>
      window.__app?.getCurrentDocument?.()?.path === expectedPath &&
      window.__editor?.getDoc?.() === text,
    { expectedPath: path, text: doc },
    { timeout: 10_000 },
  );
  await switchToMode(page, "lexical");
}

async function typeFromSourceOffset(page, doc, needle, offsetInNeedle, marker) {
  await openScratch(page, doc, marker);
  await switchToMode(page, "source");
  const source = await readEditorText(page);
  const needleStart = source.indexOf(needle);
  if (needleStart < 0) {
    throw new Error(`source needle not found: ${needle}`);
  }
  const offset = needleStart + offsetInNeedle;
  await setSelection(page, offset, offset);
  await switchToMode(page, "lexical");
  await page.waitForFunction(
    (expectedOffset) => {
      const selection = window.__editor?.getSelection?.();
      return selection?.anchor === expectedOffset && selection.focus === expectedOffset;
    },
    offset,
    { timeout: 5000 },
  );
  await page.keyboard.type(marker);
  await waitForBrowserSettled(page);
  return readEditorText(page);
}

export async function run(page) {
  await openScratch(page, "A $x+1$ B.", "math");
  await setSelection(page, 3, 3);
  await switchToMode(page, "source");
  const mathSelection = await page.evaluate(() => window.__editor?.getSelection?.() ?? null);
  if (mathSelection?.anchor !== 3 || mathSelection.focus !== 3) {
    return {
      pass: false,
      message: `rich-to-source inline math selection lost internal offset: ${JSON.stringify(mathSelection)}`,
    };
  }

  const imageDoc = "Alpha ![diagram](fig.png) omega.";
  const altDoc = await typeFromSourceOffset(page, imageDoc, "diagram", 3, "A");
  if (!altDoc.includes("![diaAgram](fig.png)")) {
    return { pass: false, message: `inline image alt offset edited the wrong location: ${JSON.stringify(altDoc)}` };
  }

  const srcDoc = await typeFromSourceOffset(page, imageDoc, "fig.png", 3, "S");
  if (!srcDoc.includes("![diagram](figS.png)")) {
    return { pass: false, message: `inline image src offset edited the wrong location: ${JSON.stringify(srcDoc)}` };
  }

  const linkDoc = await typeFromSourceOffset(
    page,
    "Alpha [link](https://example.com/path) omega.",
    "example.com",
    4,
    "U",
  );
  if (!linkDoc.includes("[link](https://examUple.com/path)")) {
    return { pass: false, message: `link URL offset edited the wrong location: ${JSON.stringify(linkDoc)}` };
  }

  const headingDoc = await typeFromSourceOffset(
    page,
    "# Intro {#sec:intro}\n\nBody\n",
    "sec:intro",
    4,
    "H",
  );
  if (!headingDoc.includes("# Intro {#sec:Hintro}")) {
    return { pass: false, message: `heading ID offset edited the wrong location: ${JSON.stringify(headingDoc)}` };
  }

  return {
    pass: true,
    message: "inline math, image, link, and heading metadata offsets preserve token-local editing",
  };
}
