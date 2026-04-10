import { describe, expect, it } from "vitest";

import { roundTripMarkdown } from "./markdown";

const FORMAT_FIXTURE = `---
title: Test Document
bibliography: refs.bib
numbering: global
math:
  \\R: "\\\\mathbb{R}"
  \\N: "\\\\mathbb{N}"
blocks:
  claim:
    title: Claim
    counter: theorem
---

# Introduction

## Background {-}

This paragraph has **bold text**, *italic text*, \`inline code\`, ~~strikethrough~~, ==highlighted== words.

Inline math: $e^{i\\pi} + 1 = 0$. Backslash inline: \\(x^2 + y^2\\).

$$
\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}
$$

$$
E = mc^2
$$ {#eq:einstein}

\\[
\\sum_{k=0}^n \\binom{n}{k} = 2^n
\\]

::: {#thm:main .theorem} Main Result
Every element of $\\R$ satisfies the property.
:::

::::: {.theorem} Nested Example
Statement.

:::: {.proof}
Nested proof.
::::
:::::

| Algorithm | Time |
|-----------|------|
| Quicksort | $O(n \\log n)$ |

- [ ] Unchecked task
- [x] Checked task

See [@thm:main] for the proof.

This has a footnote[^1].

[^1]: Footnote content with $x^2$.

::: {.include}
chapters/introduction.md
:::`;

describe("FORMAT.md carryover", () => {
  it("round-trips the representative format fixture exactly", () => {
    expect(roundTripMarkdown(FORMAT_FIXTURE)).toBe(FORMAT_FIXTURE);
  });
});
