import { DEFAULT_RUNTIME_BUDGET_PROFILE } from "./runtime-budget-profiles.mjs";

export const POST_TYPING_IDLE_OBSERVATION_MS = 500;

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

