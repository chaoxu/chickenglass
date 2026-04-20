import { describe, expect, it } from "vitest";

import { useDiagnosticsStore } from "./diagnostics-store";

describe("diagnostics store", () => {
  it("stores live diagnostics for non-CM6 editor surfaces", () => {
    useDiagnosticsStore.getState().reset();
    useDiagnosticsStore.getState().setDiagnostics([
      {
        from: 1,
        message: "test",
        severity: "warning",
        to: 2,
      },
    ]);

    expect(useDiagnosticsStore.getState().diagnostics).toHaveLength(1);
  });
});
