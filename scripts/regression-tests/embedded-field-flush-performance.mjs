import { waitForBrowserSettled } from "../test-helpers.mjs";

export const name = "embedded-field-flush-performance";
export const groups = ["core"];

const BLOCK_COUNT = 32;
const NESTED_MARKER = " NestedPerfNeedle";
const DOC = [
  "# Embedded Flush Perf",
  "",
  ...Array.from({ length: BLOCK_COUNT }, (_, index) => [
    `:::: {#lem:flush-${index + 1} .lemma title="Flush lemma ${index + 1}"}`,
    `Body ${index + 1} with inline math $m${index + 1}$ and a short explanation.`,
    "::::",
  ].join("\n")),
  "",
].join("\n\n");

async function openFlushFixture(page) {
  await page.evaluate(async (doc) => {
    const app = window.__app;
    if (app.closeFile) {
      try {
        await app.closeFile({ discard: true });
      } catch {
        // Ignore stale cleanup between cases.
      }
    }
    app.setMode("lexical");
    await app.openFileWithContent("embedded-flush-perf.md", doc);
    app.setMode("lexical");
  }, DOC);

  await page.waitForFunction(
    (expectedCount) => document.querySelectorAll(".cf-lexical-block--lemma").length >= expectedCount,
    BLOCK_COUNT,
    { timeout: 10000 },
  );
  await waitForBrowserSettled(page);
}

export async function run(page) {
  await openFlushFixture(page);

  const getDocState = await page.evaluate(async () => {
    await window.__cfDebug.clearPerf();
    const text = window.__editor.getDoc();
    const summary = await window.__cfDebug.perfSummary();
    const getSummary = summary.frontend.summaries.find((entry) => entry.name === "lexical.getLexicalMarkdown");
    const setSummary = summary.frontend.summaries.find((entry) => entry.name === "lexical.setLexicalMarkdown");
    return {
      docMatches: text === window.__editor.peekDoc(),
      getCount: getSummary?.count ?? 0,
      setCount: setSummary?.count ?? 0,
    };
  });

  if (!getDocState.docMatches || getDocState.setCount > 1 || getDocState.getCount > 3) {
    return {
      pass: false,
      message: `idle getDoc flushed embedded fields: ${JSON.stringify(getDocState)}`,
    };
  }

  const burstState = await page.evaluate(async () => {
    const beforeDoc = window.__editor.peekDoc();
    const insertOffset = beforeDoc.indexOf("Body 1");
    await window.__cfDebug.clearPerf();
    window.__editor.setSelection(insertOffset, insertOffset);
    for (let index = 0; index < 5; index += 1) {
      window.__editor.insertText("x");
    }
    const summary = await window.__cfDebug.perfSummary();
    const afterDoc = window.__editor.peekDoc();
    const summaries = summary.frontend.summaries;
    return {
      insertedAtRequestedOffset: afterDoc === `${beforeDoc.slice(0, insertOffset)}xxxxx${beforeDoc.slice(insertOffset)}`,
      insertedChars: afterDoc.length - beforeDoc.length,
      getCount: summaries.find((entry) => entry.name === "lexical.getLexicalMarkdown")?.count ?? 0,
      setCount: summaries.find((entry) => entry.name === "lexical.setLexicalMarkdown")?.count ?? 0,
    };
  });

  if (
    !burstState.insertedAtRequestedOffset
    || burstState.insertedChars !== 5
    || burstState.setCount > 8
    || burstState.getCount > 64
  ) {
    return {
      pass: false,
      message: `scripted typing burst did per-field markdown churn: ${JSON.stringify(burstState)}`,
    };
  }
  await waitForBrowserSettled(page, 10);

  const nestedBody = page.locator("section.cf-lexical-block--lemma .cf-lexical-nested-editor--block-body").nth(15);
  await nestedBody.click();
  await page.keyboard.press("Meta+A");
  await page.keyboard.press("ArrowRight");
  await page.evaluate(() => window.__cfDebug.clearPerf());
  await page.keyboard.type(NESTED_MARKER);
  await page.waitForFunction(
    (marker) => document.body.textContent?.includes(marker.trim()),
    NESTED_MARKER,
    { timeout: 5000 },
  );
  await waitForBrowserSettled(page, 10);
  const nestedState = await page.evaluate(async (marker) => {
    const summary = await window.__cfDebug.perfSummary();
    const doc = window.__editor.peekDoc();
    const summaries = summary.frontend.summaries;
    const getSummary = summaries.find((entry) => entry.name === "lexical.getLexicalMarkdown");
    const setSummary = summaries.find((entry) => entry.name === "lexical.setLexicalMarkdown");
    const sourceSyncSummary = summaries.find((entry) => entry.name === "source.syncSourceBlockPositions");
    return {
      dirty: window.__app?.isDirty?.() ?? false,
      docIncludesMarker: doc.includes(marker),
      getCount: getSummary?.count ?? 0,
      getMaxMs: getSummary?.maxMs ?? 0,
      getTotalMs: getSummary?.totalMs ?? 0,
      setCount: setSummary?.count ?? 0,
      setMaxMs: setSummary?.maxMs ?? 0,
      setTotalMs: setSummary?.totalMs ?? 0,
      sourceSyncCount: sourceSyncSummary?.count ?? 0,
      sourceSyncTotalMs: sourceSyncSummary?.totalMs ?? 0,
    };
  }, NESTED_MARKER);

  if (
    !nestedState.dirty
    || !nestedState.docIncludesMarker
    || nestedState.setCount > NESTED_MARKER.length + 3
    || nestedState.getCount > NESTED_MARKER.length * 4
    || nestedState.getMaxMs > 20
    || nestedState.getTotalMs > 120
    || nestedState.setMaxMs > 20
    || nestedState.setTotalMs > 120
    || nestedState.sourceSyncTotalMs > 20
  ) {
    return {
      pass: false,
      message: `nested embedded typing did parent-document markdown churn: ${JSON.stringify(nestedState)}`,
    };
  }

  return {
    pass: true,
    message: "idle and actively edited embedded fields avoid parent-document markdown churn",
  };
}
