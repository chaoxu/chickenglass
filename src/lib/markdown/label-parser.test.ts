import { describe, expect, it } from "vitest";

import { buildDocumentLabelParseSnapshot } from "./label-parser";

describe("buildDocumentLabelParseSnapshot references", () => {
  it("masks inline math and link destinations before scanning reference tokens", () => {
    const snapshot = buildDocumentLabelParseSnapshot(
      "See $@bar$ and [docs](https://example.com/@baz), then @real.",
    );

    expect(snapshot.references.map((reference) => reference.id)).toEqual(["real"]);
  });

  it("does not treat link labels as bracketed references", () => {
    const snapshot = buildDocumentLabelParseSnapshot(
      "See [@linked](https://example.com/ref), then [@real].",
    );

    expect(snapshot.references.map((reference) => reference.id)).toEqual(["real"]);
  });

  it("masks display math references without hiding equation labels", () => {
    const snapshot = buildDocumentLabelParseSnapshot(
      [
        "$$",
        "@hidden",
        "$$ {#eq:visible}",
        "",
        "See @real.",
      ].join("\n"),
    );

    expect(snapshot.equations.map((equation) => equation.id)).toEqual(["eq:visible"]);
    expect(snapshot.references.map((reference) => reference.id)).toEqual(["real"]);
  });
});
