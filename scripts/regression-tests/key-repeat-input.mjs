import {
  DEBUG_EDITOR_SELECTOR,
  readEditorText,
  waitForBrowserSettled,
} from "../test-helpers.mjs";

export const name = "key-repeat-input";
export const groups = ["authoring", "core"];

const REPEAT_COUNT = 5;

const HEAVY_DOC = [
  "# Key Repeat Heavy Fixture",
  "",
  ...Array.from({ length: 48 }, (_, index) => [
    `:::: {#lem:key-repeat-${index + 1} .lemma title="Repeat lemma ${index + 1}"}`,
    `Body ${index + 1} with inline math $x_${index + 1}$ and a citation-like token [@ref${index + 1}].`,
    "::::",
  ].join("\n")),
  "",
].join("\n\n");

async function openScratch(page, path, content = "") {
  await page.evaluate(async ({ nextContent, nextPath }) => {
    if (window.__app.closeFile) {
      await Promise.race([
        window.__app.closeFile({ discard: true }).catch(() => false),
        new Promise((_, reject) => {
          window.setTimeout(() => reject(new Error("closeFile timed out before key-repeat fixture open")), 5000);
        }),
      ]);
    }
    window.__app.setMode("lexical");
    await window.__app.openFileWithContent(nextPath, nextContent);
  }, { nextContent: content, nextPath: path });
  await page.waitForFunction(
    (nextPath) => window.__app?.getCurrentDocument?.()?.path === nextPath,
    path,
    { timeout: 10_000 },
  );
  await page.locator(DEBUG_EDITOR_SELECTOR).click({ force: true });
}

async function dispatchPrintableRepeat(page, char, repeatCount) {
  const client = await page.context().newCDPSession(page);
  const key = char;
  const upper = char.toUpperCase();
  const base = {
    code: `Key${upper}`,
    key,
    nativeVirtualKeyCode: upper.charCodeAt(0),
    text: char,
    unmodifiedText: char,
    windowsVirtualKeyCode: upper.charCodeAt(0),
  };
  try {
    await client.send("Input.dispatchKeyEvent", {
      ...base,
      autoRepeat: false,
      type: "keyDown",
    });
    for (let index = 0; index < repeatCount; index += 1) {
      await client.send("Input.dispatchKeyEvent", {
        ...base,
        autoRepeat: true,
        type: "keyDown",
      });
    }
    await client.send("Input.dispatchKeyEvent", {
      code: base.code,
      key,
      nativeVirtualKeyCode: base.nativeVirtualKeyCode,
      type: "keyUp",
      windowsVirtualKeyCode: base.windowsVirtualKeyCode,
    });
  } finally {
    await client.detach().catch(() => {});
  }
}

async function placeSelection(page, offset) {
  await page.evaluate((nextOffset) => {
    window.__editor.setSelection(nextOffset, nextOffset);
  }, offset);
  await waitForBrowserSettled(page, 2);
}

async function expectRepeatInserted(page, char, expectedDoc, label) {
  await dispatchPrintableRepeat(page, char, REPEAT_COUNT);
  await waitForBrowserSettled(page, 3);
  const doc = await readEditorText(page);
  if (doc !== expectedDoc) {
    return {
      pass: false,
      message: `${label}: repeat input inserted wrong text: ${JSON.stringify(doc)}`,
    };
  }
  return { pass: true };
}

export async function run(page) {
  const repeatedA = "a".repeat(REPEAT_COUNT + 1);
  await openScratch(page, "key-repeat-plain.md", "Plain: ");
  await placeSelection(page, "Plain: ".length);
  const plainResult = await expectRepeatInserted(page, "a", `Plain: ${repeatedA}`, "plain document");
  if (!plainResult.pass) return plainResult;

  const repeatedB = "b".repeat(REPEAT_COUNT + 1);
  await openScratch(page, "key-repeat-after-math.md", "$m$");
  await placeSelection(page, "$m$".length);
  const tokenResult = await expectRepeatInserted(page, "b", `$m$${repeatedB}`, "after inline math");
  if (!tokenResult.pass) return tokenResult;

  await openScratch(page, "key-repeat-heavy.md", HEAVY_DOC);
  await placeSelection(page, HEAVY_DOC.indexOf("Body 24"));
  const heavyState = await page.evaluate(async ({ char, repeatCount }) => {
    const beforeLength = window.__editor.peekDoc().length;
    const start = performance.now();
    return { beforeLength, start, char, repeatCount };
  }, { char: "c", repeatCount: REPEAT_COUNT });
  await page.evaluate(() => window.__cfDebug.clearPerf());
  await dispatchPrintableRepeat(page, heavyState.char, heavyState.repeatCount);
  await waitForBrowserSettled(page, 3);
  const heavyResult = await page.evaluate(async ({ beforeLength, start }) => {
    const summary = await window.__cfDebug.perfSummary();
    const doc = window.__editor.peekDoc();
    return {
      getCount: summary.frontend.summaries
        .find((entry) => entry.name === "lexical.getLexicalMarkdown")?.count ?? 0,
      insertedChars: doc.length - beforeLength,
      setCount: summary.frontend.summaries
        .find((entry) => entry.name === "lexical.setLexicalMarkdown")?.count ?? 0,
      sourceSyncCount: summary.frontend.summaries
        .find((entry) => entry.name === "source.syncSourceBlockPositions")?.count ?? 0,
      wallMs: performance.now() - start,
    };
  }, heavyState);

  if (
    heavyResult.insertedChars !== REPEAT_COUNT + 1
    || heavyResult.getCount > 0
    || heavyResult.setCount > 2
    || heavyResult.sourceSyncCount > 0
    || heavyResult.wallMs > 1500
  ) {
    return {
      pass: false,
      message: `heavy repeat input was not interactive: ${JSON.stringify(heavyResult)}`,
    };
  }

  return {
    pass: true,
    message: "printable repeat events insert every repeated character in plain, token-boundary, and heavy documents",
  };
}
