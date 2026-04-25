import { DEFAULT_RUNTIME_BUDGET_PROFILE } from "./runtime-budget-profiles.mjs";

export const POST_TYPING_IDLE_OBSERVATION_MS = 500;
const TYPING_PERF_POLL_INTERVAL_MS = 25;
const TYPING_CANONICAL_POLL_INTERVAL_MS = 8;

export async function measureCm6TypingBurst(page, anchor, insertCount, runtimeOptions = DEFAULT_RUNTIME_BUDGET_PROFILE) {
  return page.evaluate(async ({
    nextAnchor,
    count,
    postIdleObservationMs,
    idleSettleTimeoutMs,
  }) => {
    const mean = (values) =>
      values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
    const percentile = (values, percentileValue) => {
      if (values.length === 0) return 0;
      const sorted = [...values].sort((left, right) => left - right);
      const index = Math.ceil((percentileValue / 100) * sorted.length) - 1;
      return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
    };
    const waitForIdle = () =>
      new Promise((resolve) => {
        if (typeof window.requestIdleCallback === "function") {
          window.requestIdleCallback(() => resolve(), { timeout: idleSettleTimeoutMs });
          return;
        }
        setTimeout(resolve, 0);
      });
    const createLongTaskRecorder = () => {
      const entries = [];
      const supported = Boolean(
        typeof PerformanceObserver === "function"
        && PerformanceObserver.supportedEntryTypes?.includes("longtask"),
      );
      let observer = null;
      if (supported) {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            entries.push({ startTime: entry.startTime, duration: entry.duration });
          }
        });
        observer.observe({ type: "longtask", buffered: false });
      }
      const summarize = (from, to = Number.POSITIVE_INFINITY) => {
        const matched = entries.filter((entry) =>
          entry.startTime >= from && entry.startTime < to
        );
        const durations = matched.map((entry) => entry.duration);
        return {
          count: matched.length,
          totalMs: durations.reduce((sum, value) => sum + value, 0),
          maxMs: Math.max(...durations, 0),
        };
      };
      return {
        supported,
        disconnect() {
          observer?.disconnect();
        },
        summarize,
      };
    };
    const measureEventLoopLag = async (durationMs) => {
      const expectedFrameMs = 1000 / 60;
      const values = [];
      const end = performance.now() + durationMs;
      let last = performance.now();
      while (performance.now() < end) {
        const now = await new Promise((resolve) => {
          if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame((timestamp) => resolve(timestamp));
            return;
          }
          setTimeout(() => resolve(performance.now()), 16);
        });
        values.push(Math.max(0, now - last - expectedFrameMs));
        last = now;
      }
      return {
        samples: values.length,
        meanMs: mean(values),
        p95Ms: percentile(values, 95),
        maxMs: Math.max(...values, 0),
      };
    };

    const view = window.__cmView;
    view.dispatch({ selection: { anchor: nextAnchor }, scrollIntoView: true });
    view.focus();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const longTaskRecorder = createLongTaskRecorder();
    const timings = [];
    const observationStart = performance.now();
    const wallStart = observationStart;
    for (let i = 0; i < count; i += 1) {
      const pos = view.state.selection.main.anchor;
      const t0 = performance.now();
      view.dispatch({
        changes: { from: pos, to: pos, insert: "1" },
        selection: { anchor: pos + 1 },
      });
      timings.push(performance.now() - t0);
    }
    const wallMs = performance.now() - wallStart;
    const settleStart = performance.now();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const settleMs = performance.now() - settleStart;
    const idleStart = performance.now();
    await waitForIdle();
    const idleMs = performance.now() - idleStart;
    const postIdleStart = performance.now();
    const postIdleLag = await measureEventLoopLag(postIdleObservationMs);
    const postIdleEnd = performance.now();
    // Let buffered PerformanceObserver long-task entries flush before summarizing.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const longTasks = longTaskRecorder.summarize(observationStart, postIdleStart);
    const postIdleLongTasks = longTaskRecorder.summarize(postIdleStart, postIdleEnd);
    longTaskRecorder.disconnect();

    return {
      insertCount: count,
      wallMs,
      meanDispatchMs: mean(timings),
      p95DispatchMs: percentile(timings, 95),
      maxDispatchMs: Math.max(...timings, 0),
      settleMs,
      idleMs,
      inputToIdleMs: wallMs + settleMs + idleMs,
      wallPerCharMs: wallMs / count,
      inputToIdlePerCharMs: (wallMs + settleMs + idleMs) / count,
      longTaskSupported: longTaskRecorder.supported ? 1 : 0,
      longTaskCount: longTasks.count,
      longTaskTotalMs: longTasks.totalMs,
      longTaskMaxMs: longTasks.maxMs,
      postIdleWindowMs: postIdleObservationMs,
      postIdleLongTaskCount: postIdleLongTasks.count,
      postIdleLongTaskTotalMs: postIdleLongTasks.totalMs,
      postIdleLongTaskMaxMs: postIdleLongTasks.maxMs,
      postIdleLagSamples: postIdleLag.samples,
      postIdleLagMeanMs: postIdleLag.meanMs,
      postIdleLagP95Ms: postIdleLag.p95Ms,
      postIdleLagMaxMs: postIdleLag.maxMs,
    };
  }, {
    nextAnchor: anchor,
    count: insertCount,
    postIdleObservationMs: POST_TYPING_IDLE_OBSERVATION_MS,
    idleSettleTimeoutMs: runtimeOptions.idleSettleTimeoutMs,
  });
}

export async function measureLexicalBridgeTypingBurst(page, anchor, insertCount, runtimeOptions = DEFAULT_RUNTIME_BUDGET_PROFILE) {
  return page.evaluate(async ({
    nextAnchor,
    count,
    postIdleObservationMs,
    idleSettleTimeoutMs,
    canonicalPollIntervalMs,
    canonicalTimeoutMs,
    perfPollIntervalMs,
    semanticTimeoutMs,
    visualSyncTimeoutMs,
  }) => {
      const mean = (values) =>
        values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
      const percentile = (values, percentileValue) => {
        if (values.length === 0) return 0;
        const sorted = [...values].sort((left, right) => left - right);
        const index = Math.ceil((percentileValue / 100) * sorted.length) - 1;
        return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
      };
      const sleepInPage = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitForAnimationFrames = () =>
        new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const waitForIdle = () =>
        new Promise((resolve) => {
          if (typeof window.requestIdleCallback === "function") {
            window.requestIdleCallback(() => resolve(), { timeout: idleSettleTimeoutMs });
            return;
          }
          setTimeout(resolve, 0);
        });
      const createLongTaskRecorder = () => {
        const entries = [];
        const supported = Boolean(
          typeof PerformanceObserver === "function"
          && PerformanceObserver.supportedEntryTypes?.includes("longtask"),
        );
        let observer = null;
        if (supported) {
          observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              entries.push({ startTime: entry.startTime, duration: entry.duration });
            }
          });
          observer.observe({ type: "longtask", buffered: false });
        }
        const summarize = (from, to = Number.POSITIVE_INFINITY) => {
          const matched = entries.filter((entry) =>
            entry.startTime >= from && entry.startTime < to
          );
          const durations = matched.map((entry) => entry.duration);
          return {
            count: matched.length,
            totalMs: durations.reduce((sum, value) => sum + value, 0),
            maxMs: Math.max(...durations, 0),
          };
        };
        return {
          supported,
          disconnect() {
            observer?.disconnect();
          },
          summarize,
        };
      };
      const measureEventLoopLag = async (durationMs) => {
        const expectedFrameMs = 1000 / 60;
        const values = [];
        const end = performance.now() + durationMs;
        let last = performance.now();
        while (performance.now() < end) {
          const now = await new Promise((resolve) => {
            if (typeof requestAnimationFrame === "function") {
              requestAnimationFrame((timestamp) => resolve(timestamp));
              return;
            }
            setTimeout(() => resolve(performance.now()), 16);
          });
          values.push(Math.max(0, now - last - expectedFrameMs));
          last = now;
        }
        return {
          samples: values.length,
          meanMs: mean(values),
          p95Ms: percentile(values, 95),
          maxMs: Math.max(...values, 0),
        };
      };
      const findSummary = (summaries, name) =>
        summaries.find((summary) => summary.name === name) ?? null;

      const editor = window.__editor;
      if (!editor) {
        throw new Error("window.__editor is unavailable in Lexical mode.");
      }
      await editor.ready;
      const readCanonicalDoc = () =>
        typeof editor.peekDoc === "function" ? editor.peekDoc() : editor.getDoc();

      const beforeLength = readCanonicalDoc().length;
      const beforePerfSnapshot = await window.__cfDebug.perfSummary();
      const beforePerfSummaries = beforePerfSnapshot.frontend.summaries;
      const semanticBefore = findSummary(beforePerfSummaries, "lexical.deriveSemanticState");
      const semanticCountBefore = semanticBefore?.count ?? 0;
      const getMarkdownBefore = findSummary(beforePerfSummaries, "lexical.getLexicalMarkdown");
      const publishSnapshotBefore = findSummary(
        beforePerfSummaries,
        "lexical.publishRichDocumentSnapshot",
      );
      const deferredSyncBefore = findSummary(beforePerfSummaries, "lexical.setLexicalMarkdown");
      const incrementalSyncBefore = findSummary(
        beforePerfSummaries,
        "lexical.incrementalRichSync",
      );
      editor.setSelection(nextAnchor);
      editor.focus();
      await waitForAnimationFrames();
      const sourceSpanIndexBefore = findSummary(
        beforePerfSummaries,
        "lexical.createSourceSpanIndex",
      );

      const longTaskRecorder = createLongTaskRecorder();
      const timings = [];
      const beforeDeferredCount = deferredSyncBefore?.count ?? 0;
      const beforeDeferredTotalMs = deferredSyncBefore?.totalMs ?? 0;
      const beforeIncrementalCount = incrementalSyncBefore?.count ?? 0;
      const beforeIncrementalTotalMs = incrementalSyncBefore?.totalMs ?? 0;
      const expectedLength = beforeLength + count;
      const observationStart = performance.now();
      const wallStart = observationStart;
      for (let i = 0; i < count; i += 1) {
        const t0 = performance.now();
        editor.insertText("1");
        timings.push(performance.now() - t0);
      }
      const wallMs = performance.now() - wallStart;

      const syncObservationStart = performance.now();
      let lastPerfSampleAt = Number.NEGATIVE_INFINITY;
      let deferredSyncAfter = deferredSyncBefore;
      let incrementalSyncAfter = incrementalSyncBefore;
      let semanticAfter = semanticBefore;
      let finalLength = readCanonicalDoc().length;
      let canonicalMs = finalLength >= expectedLength ? 0 : null;
      let visualSyncMs = null;
      let semanticMs = null;
      let visualSyncObserved = false;
      let semanticObserved = false;
      let finalTimeoutPerfSampleTaken = false;
      const samplePerfSummary = async () => {
        const perfSnapshot = await window.__cfDebug.perfSummary();
        const perfSampleAt = performance.now();
        lastPerfSampleAt = perfSampleAt;
        const perfSummaries = perfSnapshot.frontend.summaries;
        deferredSyncAfter = findSummary(perfSummaries, "lexical.setLexicalMarkdown");
        incrementalSyncAfter = findSummary(perfSummaries, "lexical.incrementalRichSync");
        semanticAfter = findSummary(perfSummaries, "lexical.deriveSemanticState");
        if (
          !visualSyncObserved
          && (
            (deferredSyncAfter?.count ?? 0) > beforeDeferredCount
            || (incrementalSyncAfter?.count ?? 0) > beforeIncrementalCount
          )
        ) {
          visualSyncObserved = true;
          visualSyncMs = perfSampleAt - syncObservationStart;
        }
        if (
          !semanticObserved
          && (semanticAfter?.count ?? 0) > semanticCountBefore
        ) {
          semanticObserved = true;
          semanticMs = perfSampleAt - syncObservationStart;
        }
      };
      while (true) {
        const now = performance.now();
        if (canonicalMs == null) {
          finalLength = readCanonicalDoc().length;
          if (finalLength >= expectedLength) {
            canonicalMs = now - syncObservationStart;
          }
        }
        const elapsedMs = now - syncObservationStart;
        const visualWaitExpired = elapsedMs >= visualSyncTimeoutMs;
        const semanticWaitExpired = elapsedMs >= semanticTimeoutMs;
        const canonicalWaitExpired = elapsedMs >= canonicalTimeoutMs;
        const needsSummaryPolling =
          (!visualSyncObserved && !visualWaitExpired)
          || (!semanticObserved && !semanticWaitExpired);
        if (
          needsSummaryPolling
          && now - lastPerfSampleAt >= perfPollIntervalMs
        ) {
          await samplePerfSummary();
        }
        const canClassify =
          (visualSyncObserved || visualWaitExpired)
          && (semanticObserved || semanticWaitExpired)
          && (canonicalMs != null || canonicalWaitExpired);
        if (
          canClassify
          && !finalTimeoutPerfSampleTaken
          && (!visualSyncObserved || !semanticObserved)
        ) {
          finalTimeoutPerfSampleTaken = true;
          await samplePerfSummary();
          continue;
        }
        if (canClassify) {
          break;
        }
        await sleepInPage(canonicalMs == null ? canonicalPollIntervalMs : perfPollIntervalMs);
      }
      const syncObservationEnd = performance.now();
      if (canonicalMs == null) {
        canonicalMs = syncObservationEnd - syncObservationStart;
      }
      if (semanticMs == null) {
        semanticMs = syncObservationEnd - syncObservationStart;
      }
      finalLength = readCanonicalDoc().length;
      if (finalLength < expectedLength) {
        throw new Error(
          `Lexical bridge insert did not update canonical markdown: expected length >= ${expectedLength}, got ${finalLength}.`,
        );
      }

      const settleStart = performance.now();
      await waitForAnimationFrames();
      await waitForIdle();
      const settleMs = performance.now() - settleStart;
      const postIdleStart = performance.now();
      const postIdleLag = await measureEventLoopLag(postIdleObservationMs);
      const postIdleEnd = performance.now();
      // Let buffered PerformanceObserver long-task entries flush before summarizing.
      await sleepInPage(0);
      const longTasks = longTaskRecorder.summarize(observationStart, postIdleStart);
      const postIdleLongTasks = longTaskRecorder.summarize(postIdleStart, postIdleEnd);
      longTaskRecorder.disconnect();

      const afterPerfSnapshot = await window.__cfDebug.perfSummary();
      const afterPerfSummaries = afterPerfSnapshot.frontend.summaries;
      const deferredSyncFinal = findSummary(afterPerfSummaries, "lexical.setLexicalMarkdown");
      const incrementalSyncFinal = findSummary(afterPerfSummaries, "lexical.incrementalRichSync");
      const sourceSpanIndexAfter = findSummary(
        afterPerfSummaries,
        "lexical.createSourceSpanIndex",
      );
      const getMarkdownAfter = findSummary(afterPerfSummaries, "lexical.getLexicalMarkdown");
      const publishSnapshotAfter = findSummary(
        afterPerfSummaries,
        "lexical.publishRichDocumentSnapshot",
      );
      const semanticAfterFinal = findSummary(
        afterPerfSummaries,
        "lexical.deriveSemanticState",
      );
      const deferredSyncCount = Math.max(
        0,
        (deferredSyncFinal?.count ?? 0) - beforeDeferredCount,
      );
      const deferredSyncWorkMs = Math.max(
        0,
        (deferredSyncFinal?.totalMs ?? 0) - beforeDeferredTotalMs,
      );
      const incrementalSyncCount = Math.max(
        0,
        (incrementalSyncFinal?.count ?? 0) - beforeIncrementalCount,
      );
      const incrementalSyncWorkMs = Math.max(
        0,
        (incrementalSyncFinal?.totalMs ?? 0) - beforeIncrementalTotalMs,
      );
      const sourceSpanIndexCount = Math.max(
        0,
        (sourceSpanIndexAfter?.count ?? 0) - (sourceSpanIndexBefore?.count ?? 0),
      );
      const sourceSpanIndexWorkMs = Math.max(
        0,
        (sourceSpanIndexAfter?.totalMs ?? 0) - (sourceSpanIndexBefore?.totalMs ?? 0),
      );
      const semanticWorkCount = Math.max(
        0,
        (semanticAfterFinal?.count ?? 0) - (semanticBefore?.count ?? 0),
      );
      const semanticWorkMs = Math.max(
        0,
        (semanticAfterFinal?.totalMs ?? 0) - (semanticBefore?.totalMs ?? 0),
      );
      const getMarkdownWorkCount = Math.max(
        0,
        (getMarkdownAfter?.count ?? 0) - (getMarkdownBefore?.count ?? 0),
      );
      const getMarkdownWorkMs = Math.max(
        0,
        (getMarkdownAfter?.totalMs ?? 0) - (getMarkdownBefore?.totalMs ?? 0),
      );
      const publishSnapshotWorkCount = Math.max(
        0,
        (publishSnapshotAfter?.count ?? 0) - (publishSnapshotBefore?.count ?? 0),
      );
      const publishSnapshotWorkMs = Math.max(
        0,
        (publishSnapshotAfter?.totalMs ?? 0) - (publishSnapshotBefore?.totalMs ?? 0),
      );

      return {
        insertCount: count,
        wallMs,
        wallPerCharMs: wallMs / count,
        meanInsertMs: mean(timings),
        p95InsertMs: percentile(timings, 95),
        maxInsertMs: Math.max(...timings, 0),
        canonicalMs,
        visualSyncMs: visualSyncMs ?? 0,
        visualSyncObserved,
        visualSyncTimeoutMs,
        semanticMs,
        semanticObserved,
        semanticWorkCount,
        semanticWorkMs,
        getMarkdownWorkCount,
        getMarkdownWorkMs,
        publishSnapshotWorkCount,
        publishSnapshotWorkMs,
        settleMs,
        deferredSyncCount,
        deferredSyncWorkMs,
        incrementalSyncCount,
        incrementalSyncWorkMs,
        sourceSpanIndexCount,
        sourceSpanIndexWorkMs,
        longTaskSupported: longTaskRecorder.supported ? 1 : 0,
        longTaskCount: longTasks.count,
        longTaskTotalMs: longTasks.totalMs,
        longTaskMaxMs: longTasks.maxMs,
        postIdleWindowMs: postIdleObservationMs,
        postIdleLongTaskCount: postIdleLongTasks.count,
        postIdleLongTaskTotalMs: postIdleLongTasks.totalMs,
        postIdleLongTaskMaxMs: postIdleLongTasks.maxMs,
        postIdleLagSamples: postIdleLag.samples,
        postIdleLagMeanMs: postIdleLag.meanMs,
        postIdleLagP95Ms: postIdleLag.p95Ms,
        postIdleLagMaxMs: postIdleLag.maxMs,
      };
    },
    {
      nextAnchor: anchor,
      count: insertCount,
      postIdleObservationMs: POST_TYPING_IDLE_OBSERVATION_MS,
      idleSettleTimeoutMs: runtimeOptions.idleSettleTimeoutMs,
      canonicalPollIntervalMs: TYPING_CANONICAL_POLL_INTERVAL_MS,
      canonicalTimeoutMs: runtimeOptions.typingCanonicalTimeoutMs,
      perfPollIntervalMs: TYPING_PERF_POLL_INTERVAL_MS,
      semanticTimeoutMs: runtimeOptions.typingSemanticTimeoutMs,
      visualSyncTimeoutMs: runtimeOptions.typingVisualSyncTimeoutMs,
    },
  );
}
