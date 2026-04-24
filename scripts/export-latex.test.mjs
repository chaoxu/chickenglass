import { delimiter } from "node:path";

import { describe, expect, it } from "vitest";

import { buildPandocResourcePath } from "../src/latex/export-options.mjs";
import { parseExportLatexArgs } from "./export-latex.mjs";

describe("export-latex CLI profile", () => {
  it("parses documented equals and space flag forms through the shared parser", () => {
    expect(
      parseExportLatexArgs([
        "paper.md",
        "--output=out.tex",
        "--template",
        "lipics",
        "--bibliography=refs.bib",
        "--pandoc",
        "/usr/local/bin/pandoc",
        "--dump-markdown",
      ]),
    ).toEqual({
      flags: {
        bibliography: "refs.bib",
        "dump-markdown": true,
        output: "out.tex",
        pandoc: "/usr/local/bin/pandoc",
        template: "lipics",
      },
      positional: ["paper.md"],
    });
  });

  it("matches desktop export resource-path semantics", () => {
    expect(buildPandocResourcePath("/project", "/project/notes", { delimiter })).toBe(
      ["/project/notes", "/project"].join(delimiter),
    );
    expect(buildPandocResourcePath("/project", "/project", { delimiter })).toBe("/project");
  });
});
