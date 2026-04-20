import { describe, expect, it } from "vitest";

import {
  createRedactionContext,
  redactBibtex,
  redactMarkdown,
} from "./generate-public-heavy-fixture.mjs";

describe("public heavy fixture generator", () => {
  it("redacts non-math prose while preserving math and remapping public identifiers", () => {
    const markdown = `---
title: haha
bibliography: secret.bib
math:
  \\Foo: "\\\\text{KeepMath}"
---

# haha $a+b$

::: {#lem:secret-slug .lemma} haha
haha cites [@SecretKey] and [@lem:secret-slug].
:::
`;
    const bib = `@article{SecretKey,
  author = {haha},
  title = {haha}
}
`;
    const context = createRedactionContext(markdown, bib);

    const redactedMarkdown = redactMarkdown(markdown, context);
    const redactedBib = redactBibtex(bib, context);

    expect(redactedMarkdown).toContain("title: xxxx");
    expect(redactedMarkdown).toContain("bibliography: refs.bib");
    expect(redactedMarkdown).toContain("$a+b$");
    expect(redactedMarkdown).toContain("\\Foo: \"\\\\text{KeepMath}\"");
    expect(redactedMarkdown).toContain("::: {#lem:public-0001 .lemma} xxxx");
    expect(redactedMarkdown).toContain("[@cite0001]");
    expect(redactedMarkdown).toContain("[@lem:public-0001]");
    expect(redactedMarkdown).not.toContain("haha");
    expect(redactedMarkdown).not.toContain("SecretKey");
    expect(redactedMarkdown).not.toContain("secret-slug");

    expect(redactedBib).toContain("@article{cite0001,");
    expect(redactedBib).toContain("author = {xxxx}");
    expect(redactedBib).not.toContain("SecretKey");
    expect(redactedBib).not.toContain("haha");
  });
});
