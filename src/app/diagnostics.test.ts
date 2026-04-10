import { describe, expect, it } from "vitest";

import { extractDiagnostics } from "./diagnostics";

describe("extractDiagnostics", () => {
  it("warns on unresolved local references", () => {
    expect(extractDiagnostics("See [@thm:missing] and [@karger2000].")).toEqual([
      expect.objectContaining({
        severity: "warning",
        message: 'Unresolved reference "@thm:missing"',
      }),
    ]);
  });

  it("reports duplicate local target ids", () => {
    const diagnostics = extractDiagnostics([
      "# Intro {#dup}",
      "",
      "::: {.theorem #dup}",
      "Statement.",
      ":::",
    ].join("\n"));

    expect(diagnostics).toEqual([
      expect.objectContaining({
        severity: "error",
        message: 'Duplicate local target ID "dup"',
      }),
      expect.objectContaining({
        severity: "error",
        message: 'Duplicate local target ID "dup"',
      }),
    ]);
  });
});
