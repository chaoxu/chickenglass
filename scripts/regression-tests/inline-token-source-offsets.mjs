import {
  readEditorText,
  setSelection,
  switchToMode,
  waitForBrowserSettled,
} from "../test-helpers.mjs";

export const name = "inline-token-source-offsets";
export const groups = ["reveal"];

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
  ).catch(async (error) => {
    const state = await page.evaluate(() => ({
      currentPath: window.__app?.getCurrentDocument?.()?.path ?? null,
      doc: window.__editor?.getDoc?.() ?? null,
      mode: window.__app?.getMode?.() ?? null,
    }));
    throw new Error(`openScratch timed out for ${label}: ${error.message}; state=${JSON.stringify(state)}`);
  });
  await switchToMode(page, "lexical");
}

async function typeFromSourceOffset(page, doc, needle, offsetInNeedle, marker) {
  await openScratch(page, doc, marker);
  await switchToMode(page, "source");
  await waitForBrowserSettled(page);
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
  ).catch(async (error) => {
    const state = await page.evaluate(() => ({
      doc: window.__editor?.getDoc?.() ?? "",
      mode: window.__app?.getMode?.() ?? null,
      selection: window.__editor?.getSelection?.() ?? null,
      links: [...document.querySelectorAll("a.cf-lexical-link")]
        .map((element) => ({
          href: element.getAttribute("href"),
          text: element.textContent,
          title: element.getAttribute("title"),
        })),
      revealText: [...document.querySelectorAll("[data-lexical-text='true']")]
        .map((element) => element.textContent ?? "")
        .find((text) => text.includes("http") || text.includes("[^") || text.includes("!["))
        ?? null,
    }));
    throw new Error(`selection did not round-trip for ${marker} at ${offset}: ${error.message}; state=${JSON.stringify(state)}`);
  });
  await page.keyboard.type(marker);
  await waitForBrowserSettled(page);
  return readEditorText(page);
}

async function typeFromLexicalSourceOffset(page, doc, needle, offsetInNeedle, marker) {
  await openScratch(page, doc, marker);
  const source = await readEditorText(page);
  const needleStart = source.indexOf(needle);
  if (needleStart < 0) {
    throw new Error(`source needle not found: ${needle}`);
  }
  const offset = needleStart + offsetInNeedle;
  await page.evaluate((nextOffset) => {
    window.__editor.setSelection(nextOffset, nextOffset);
  }, offset);
  await waitForBrowserSettled(page);
  await page.keyboard.type(marker);
  await waitForBrowserSettled(page);
  return readEditorText(page);
}

async function replaceFirstRevealSource(page, nextSource) {
  await page.waitForFunction(
    () => [...document.querySelectorAll("[data-lexical-text='true']")]
      .some((element) => element.textContent?.startsWith("[")),
    undefined,
    { timeout: 5000 },
  );
  await page.evaluate(() => {
    const reveal = [...document.querySelectorAll("[data-lexical-text='true']")]
      .find((element) => element.textContent?.startsWith("["));
    if (!reveal?.firstChild) {
      throw new Error("missing reveal source text");
    }
    const range = document.createRange();
    range.selectNodeContents(reveal.firstChild);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.keyboard.type(nextSource);
  await waitForBrowserSettled(page);
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

  await openScratch(page, "A $x$ B.", "active-math");
  await page.locator(".cf-lexical-inline-math .katex").first().click();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("2");
  await waitForBrowserSettled(page);
  await switchToMode(page, "source");
  const activeMathState = await page.evaluate(() => ({
    dirty: window.__app?.isDirty?.() ?? false,
    doc: window.__editor?.getDoc?.() ?? "",
  }));
  if (!activeMathState.doc.includes("$x2$") || !activeMathState.dirty) {
    return {
      pass: false,
      message: `active inline math reveal edit was not flushed to source mode: ${JSON.stringify(activeMathState)}`,
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

  const titledLinkDoc = await typeFromLexicalSourceOffset(
    page,
    'Alpha [**rich** link](https://example.com/path "A title") omega.',
    "title",
    2,
    "T",
  );
  if (!titledLinkDoc.includes('[**rich** link](https://example.com/path "A tiTtle")')) {
    return { pass: false, message: `link title/formatted-label source offset edited the wrong location: ${JSON.stringify(titledLinkDoc)}` };
  }

  await openScratch(
    page,
    'Alpha [plain](https://example.com/path "A title") omega.',
    "noncanonical-link",
  );
  await page.locator("a.cf-lexical-link").first().click({ force: true });
  await replaceFirstRevealSource(page, "[paren](https://example.com/a(b)c (paren title))");
  await page.keyboard.press("ArrowRight");
  await waitForBrowserSettled(page);
  const nonCanonicalLinkState = await page.evaluate(() => ({
    doc: window.__editor?.getDoc?.() ?? "",
    href: document.querySelector("a.cf-lexical-link")?.getAttribute("href") ?? "",
    text: document.querySelector("a.cf-lexical-link")?.textContent ?? "",
    title: document.querySelector("a.cf-lexical-link")?.getAttribute("title") ?? "",
  }));
  if (
    nonCanonicalLinkState.href !== "https://example.com/a(b)c"
    || nonCanonicalLinkState.text !== "paren"
    || nonCanonicalLinkState.title !== "paren title"
    || !nonCanonicalLinkState.doc.includes('[paren](https://example.com/a(b)c "paren title")')
  ) {
    return {
      pass: false,
      message: `noncanonical link reveal did not reparse through the source scanner: ${JSON.stringify(nonCanonicalLinkState)}`,
    };
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

  const citationDoc = await typeFromSourceOffset(
    page,
    "Alpha [@cormen2009] omega.",
    "cormen",
    2,
    "C",
  );
  if (!citationDoc.includes("[@coCrmen2009]")) {
    return { pass: false, message: `citation offset edited the wrong location: ${JSON.stringify(citationDoc)}` };
  }

  const footnoteDoc = await typeFromSourceOffset(
    page,
    "Alpha [^note] omega.\n\n[^note]: Body.",
    "^note",
    2,
    "F",
  );
  if (!footnoteDoc.includes("[^nFote] omega.")) {
    return { pass: false, message: `footnote reference offset edited the wrong location: ${JSON.stringify(footnoteDoc)}` };
  }

  const footnoteContinuationDoc = await typeFromSourceOffset(
    page,
    "Alpha footnote.[^note]\n\n[^note]: First line\n  second line.",
    "second",
    3,
    "N",
  );
  if (!footnoteContinuationDoc.includes("[^note]: First line\n  secNond line.")) {
    return { pass: false, message: `footnote continuation offset edited the wrong location: ${JSON.stringify(footnoteContinuationDoc)}` };
  }

  return {
    pass: true,
    message: "inline reveal edits and metadata offsets preserve token-local editing",
  };
}
