import path from "node:path";
import { describe, expect, it } from "vitest";

import { findBareCatchClauses } from "./check-bare-catch.mjs";

describe("bare catch checker", () => {
  it("flags catch clauses without bindings", () => {
    expect(
      findBareCatchClauses(
        path.join(process.cwd(), "src", "example.ts"),
        "try { work(); } catch { recover(); }\n",
      ),
    ).toEqual([
      {
        filePath: path.join(process.cwd(), "src", "example.ts"),
        line: 1,
      },
    ]);
  });

  it("allows explicit ignored-error bindings", () => {
    expect(
      findBareCatchClauses(
        path.join(process.cwd(), "src", "example.ts"),
        "try { work(); } catch (_error) { recover(); }\n",
      ),
    ).toEqual([]);
  });
});
