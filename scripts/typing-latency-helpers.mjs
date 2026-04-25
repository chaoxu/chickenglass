import { DEFAULT_RUNTIME_BUDGET_PROFILE } from "./runtime-budget-profiles.mjs";

export function summarizeDurations(values) {
  const samples = values.filter((value) => Number.isFinite(value));
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (percentileValue) => {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((percentileValue / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  };
  return {
    maxMs: Math.max(...samples, 0),
    meanMs: samples.reduce((sum, value) => sum + value, 0) / (samples.length || 1),
    p95Ms: percentile(95),
    samples: samples.length,
  };
}

export async function measureEditorBridgeTypingLatency(page, options) {
  const {
    anchorNeedle,
    canonicalTimeoutMs = DEFAULT_RUNTIME_BUDGET_PROFILE.typingCanonicalTimeoutMs,
    idleSettleTimeoutMs = DEFAULT_RUNTIME_BUDGET_PROFILE.idleSettleTimeoutMs,
    insertText,
  } = options;
  if (!anchorNeedle) {
    throw new Error("measureEditorBridgeTypingLatency requires anchorNeedle.");
  }
  if (!insertText) {
    throw new Error("measureEditorBridgeTypingLatency requires insertText.");
  }

  return page.evaluate(async ({
    nextAnchorNeedle,
    nextCanonicalTimeoutMs,
    nextIdleSettleTimeoutMs,
    nextInsertText,
  }) => {
    const summarize = (values) => {
      const samples = values.filter((value) => Number.isFinite(value));
      const sorted = [...samples].sort((left, right) => left - right);
      const percentile = (percentileValue) => {
        if (sorted.length === 0) return 0;
        const index = Math.ceil((percentileValue / 100) * sorted.length) - 1;
        return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
      };
      return {
        maxMs: Math.max(...samples, 0),
        meanMs: samples.reduce((sum, value) => sum + value, 0) / (samples.length || 1),
        p95Ms: percentile(95),
        samples: samples.length,
      };
    };
    const sleepInPage = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitForFrames = () =>
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const waitForIdle = () =>
      new Promise((resolve) => {
        if (typeof window.requestIdleCallback === "function") {
          window.requestIdleCallback(() => resolve(), { timeout: nextIdleSettleTimeoutMs });
          return;
        }
        setTimeout(resolve, 0);
      });

    const editor = window.__editor;
    if (!editor?.getDoc || !editor?.setSelection || !editor?.insertText || !editor?.focus) {
      throw new Error("window.__editor typing bridge is unavailable.");
    }
    await editor.ready;

    const before = editor.getDoc();
    const index = before.indexOf(nextAnchorNeedle);
    if (index < 0) {
      throw new Error(`Typing anchor ${JSON.stringify(nextAnchorNeedle)} is missing.`);
    }
    const anchor = index + nextAnchorNeedle.length;
    editor.setSelection(anchor, anchor);
    editor.focus();
    await waitForFrames();

    const timings = [];
    const wallStart = performance.now();
    for (const char of nextInsertText) {
      const charStart = performance.now();
      editor.insertText(char);
      timings.push(performance.now() - charStart);
    }
    const wallMs = performance.now() - wallStart;

    const expectedLength = before.length + nextInsertText.length;
    const expectedText = `${nextAnchorNeedle}${nextInsertText}`;
    const canonicalStart = performance.now();
    let after = editor.getDoc();
    while (
      performance.now() - canonicalStart < nextCanonicalTimeoutMs &&
      (after.length < expectedLength || !after.includes(expectedText))
    ) {
      await sleepInPage(8);
      after = editor.getDoc();
    }
    const canonicalMs = performance.now() - canonicalStart;
    if (after.length < expectedLength || !after.includes(expectedText)) {
      throw new Error(
        `Typing burst did not persist: expected length >= ${expectedLength}, ` +
          `got ${after.length}, expectedText=${JSON.stringify(expectedText)}`,
      );
    }

    const idleStart = performance.now();
    await waitForFrames();
    await waitForIdle();
    const inputToIdleMs = performance.now() - wallStart;
    const dispatch = summarize(timings);

    return {
      canonicalMs,
      docLength: after.length,
      idleAfterInputMs: performance.now() - idleStart,
      inputToIdleMs,
      insertCount: nextInsertText.length,
      insertMaxMs: dispatch.maxMs,
      insertMeanMs: dispatch.meanMs,
      insertP95Ms: dispatch.p95Ms,
      wallMs,
      wallPerCharMs: wallMs / nextInsertText.length,
    };
  }, {
    nextAnchorNeedle: anchorNeedle,
    nextCanonicalTimeoutMs: canonicalTimeoutMs,
    nextIdleSettleTimeoutMs: idleSettleTimeoutMs,
    nextInsertText: insertText,
  });
}
