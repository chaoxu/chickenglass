import { describe, expect, it } from "vitest";
import {
  findReverseScrollJump,
  formatCursorScrollReport,
  resolveCursorScrollTimeout,
  resolveCursorScrollTraceOptions,
} from "./cursor-scroll-regression.mjs";
import { DEFAULT_RUNTIME_BUDGET_PROFILE } from "./runtime-budget-profiles.mjs";

const baseEntry = (overrides = {}) => ({
  step: 0,
  head: 0,
  anchor: 0,
  line: 1,
  lineText: "",
  scrollTop: 0,
  cursorTop: 0,
  cursorBottom: 20,
  lineInfo: null,
  nearbyLines: [],
  ...overrides,
});

describe("cursor scroll regression", () => {
  it("detects a large reverse scroll jump while moving upward", () => {
    const trace = [
      baseEntry({
        step: 0,
        head: 9000,
        line: 725,
        lineText: "Since $M_{2,2}(K_n)=M(K_n)\\\\vee M(K_n)$, ...",
        scrollTop: 21228,
        cursorTop: 710,
      }),
      baseEntry({
        step: 1,
        head: 8970,
        line: 724,
        lineText: "::: {.proof}",
        scrollTop: 21536,
        cursorTop: 402,
        lineInfo: { hidden: false, classes: ["cf-block-header"] },
        nearbyLines: [
          { line: 722, text: ":::", info: { hidden: true, classes: ["cf-fence-close"] } },
          { line: 724, text: "::: {.proof}", info: { hidden: false, classes: ["cf-block-header"] } },
          { line: 725, text: "Since $M_{2,2}(K_n)=M(K_n)\\\\vee M(K_n)$, ...", info: null },
        ],
      }),
    ];

    const anomaly = findReverseScrollJump(trace, {
      direction: "up",
      minReverseScrollPx: 120,
    });

    expect(anomaly).toMatchObject({
      index: 1,
      lineDelta: -1,
      scrollDelta: 308,
      headDelta: -30,
    });
  });

  it("ignores ordinary jitter below the reverse-jump threshold", () => {
    const trace = [
      baseEntry({ step: 0, head: 5000, line: 300, scrollTop: 12000, cursorTop: 640 }),
      baseEntry({ step: 1, head: 4980, line: 299, scrollTop: 12018, cursorTop: 620 }),
      baseEntry({ step: 2, head: 4960, line: 298, scrollTop: 11980, cursorTop: 601 }),
    ];

    expect(findReverseScrollJump(trace, {
      direction: "up",
      minReverseScrollPx: 120,
    })).toBeNull();
  });

  it("formats the anomaly report with fixture and nearby line context", () => {
    const traceResult = {
      direction: "up",
      stopReason: null,
      trace: [
        baseEntry({
          step: 0,
          head: 9000,
          line: 725,
          lineText: "Since $M_{2,2}(K_n)=M(K_n)\\\\vee M(K_n)$, ...",
          scrollTop: 21228,
          cursorTop: 710,
        }),
        baseEntry({
          step: 1,
          head: 8970,
          line: 724,
          lineText: "::: {.proof}",
          scrollTop: 21536,
          cursorTop: 402,
          lineInfo: { hidden: false, classes: ["cf-block-header"] },
          nearbyLines: [
            { line: 722, text: ":::", info: { hidden: true, classes: ["cf-fence-close"] } },
            { line: 724, text: "::: {.proof}", info: { hidden: false, classes: ["cf-block-header"] } },
            { line: 725, text: "Since $M_{2,2}(K_n)=M(K_n)\\\\vee M(K_n)$, ...", info: null },
          ],
        }),
      ],
    };
    const anomaly = findReverseScrollJump(traceResult.trace, {
      direction: "up",
      minReverseScrollPx: 120,
    });

    const report = formatCursorScrollReport({
      fixture: {
        displayPath: "fixtures/rankdecrease/main.md",
        resolvedPath: "/tmp/rankdecrease/main.md",
        method: "openFileWithContent",
      },
      traceResult,
      anomaly,
      minReverseScrollPx: 120,
    });

    expect(report).toContain("fixtures/rankdecrease/main.md");
    expect(report).toContain("Reverse scroll jump detected at step 1");
    expect(report).toContain("scrollTop 21228 -> 21536 (+308px)");
    expect(report).toContain("::: {.proof}");
    expect(report).toContain("hidden=true");
  });

  it("parses the browser/debug bridge timeout flag", () => {
    expect(resolveCursorScrollTimeout(["--timeout", "42000"])).toBe(42000);
    expect(resolveCursorScrollTimeout([])).toBe(
      DEFAULT_RUNTIME_BUDGET_PROFILE.debugBridgeTimeoutMs,
    );
    expect(() => resolveCursorScrollTimeout(["--timeout", "15s"])).toThrow(
      "Invalid integer value for --timeout: 15s",
    );
  });

  it("leaves the start line unset unless the CLI explicitly overrides it", () => {
    expect(resolveCursorScrollTraceOptions([], "up").startLine).toBeUndefined();
    expect(resolveCursorScrollTraceOptions(["--start-line", "321"], "up")).toMatchObject({
      direction: "up",
      startLine: 321,
      startColumn: 0,
      steps: 250,
    });
  });
});
