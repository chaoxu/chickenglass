export const defaultDemoFiles: Record<string, string> = {
    "coflat.yaml": `# Project configuration — shared settings inherited by all documents.
# Per-file frontmatter can override any of these.
bibliography: refs.bib
math:
  \\R: "\\\\mathbb{R}"
  \\N: "\\\\mathbb{N}"
  \\Z: "\\\\mathbb{Z}"
  \\Q: "\\\\mathbb{Q}"
  \\F: "\\\\mathbb{F}"
  \\e: "\\\\varepsilon"
  \\set: "\\\\left\\\\{#1\\\\right\\\\}"
  \\ceil: "\\\\left\\\\lceil#1\\\\right\\\\rceil"
  \\floor: "\\\\left\\\\lfloor#1\\\\right\\\\rfloor"
  \\bm: "\\\\boldsymbol{#1}"
`,
    "main.md": `---
title: Coflat Demo
---

A semantic document editor for **mathematical writing**. It supports rich editing, ~~strikethrough~~, ==highlights==, and \`inline code\`.

This document demonstrates theorem environments, cross-references, citations, images, math, sidenotes, and blockquotes in a single Pandoc-flavored markdown file.

# Math

The Euler identity $e^{i\\pi} + 1 = 0$ unites five fundamental constants. Custom macros work too: $\\R$, $\\N$, $\\Z$.

# Images

![Tiny demo image](chapters/diagram.png)

Display math with equation labels:

$$
\\int_0^\\infty e^{-x^2} \\, dx = \\frac{\\sqrt{\\pi}}{2}
$$ {#eq:gaussian}

$$
\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}
$$ {#eq:sum}

# Theorems & Proofs

::: {.theorem #thm-evt title="Extreme Value Theorem"}
Every continuous function $f: [a,b] \\to \\R$ attains its maximum and minimum.
:::

::: {.proof}
Since $[a,b]$ is compact and $f$ is continuous, $f([a,b])$ is compact in $\\R$, hence closed and bounded. By the least upper bound property, the supremum is attained.
:::

::: {.lemma #lem-compact}
A continuous image of a compact set is compact.
:::

::: {.definition #def-compact}
A set $K \\subseteq \\R$ is **compact** if every open cover of $K$ has a finite subcover.
:::

::: {.corollary #cor-bounded}
Every continuous function on a closed interval is bounded.
:::

::: {.theorem title="Bolzano-Weierstrass"}
Every bounded sequence in $\\R$ has a convergent subsequence.
:::

::: {.problem #prob-macros title="Custom Macros"}
Show that $\\set{x \\in \\R : \\floor{x} = \\ceil{x}}$ equals $\\Z$, and that for any $\\e > 0$ there exists $n \\in \\N$ with $1/n < \\e$.
:::

::: {.corollary}
Every continuous function on a closed interval is bounded.
:::

::: {.remark}
The converse of the Extreme Value Theorem is false.
:::

# Cross-References

See [@thm-evt] for the main result, which relies on [@lem-compact]. The key definition is [@def-compact]. The Gaussian integral is [@eq:gaussian], and the summation formula is [@eq:sum].

# Citations

Minimum cuts can be computed efficiently [@karger2000]. As shown by @cormen2009, graph algorithms are fundamental to computer science. For classic references on algorithm analysis, see [@knuth1997; @karger2000].

# Lists

Key concepts:

- **Compactness** in $\\R$: closed and bounded (Heine-Borel)
- **Continuity**: preserves limits
  - Uniform continuity: $\\delta$ independent of $x$
  - Lipschitz continuity: bounded derivative
    - Every Lipschitz function is uniformly continuous
- **Connectedness**: cannot be split into disjoint open sets

Steps to prove the Extreme Value Theorem:

1. Show $f([a,b])$ is compact
2. Conclude it is closed and bounded
3. The supremum exists and is attained

Task list:

- [x] Implement math rendering
- [x] Add theorem environments
- [ ] Export to PDF via Pandoc
- [ ] Add real-time collaboration

# Tables

| Property      | Symbol        | Description                              |
| :------------ | :-----------: | ---------------------------------------: |
| Natural nums  | $\\N$         | Counting numbers $\\{1, 2, 3, \\ldots\\}$ |
| Integers      | $\\Z$         | $\\{\\ldots, -1, 0, 1, \\ldots\\}$        |
| Reals         | $\\R$         | The complete ordered field               |
| Euler's       | $e^{i\\pi}$   | The most beautiful identity              |

# Code

\`\`\`typescript
function isPrime(n: number): boolean {
  if (n <= 1) return false;
  for (let i = 2; i * i <= n; i++) {
    if (n % i === 0) return false;
  }
  return true;
}
\`\`\`

# Sidenotes

The Extreme Value Theorem[^evt] is fundamental to real analysis. Compactness[^compact] plays a key role in the proof.

[^evt]: First proved by Weierstrass. Every continuous function $f: [a,b] \\to \\R$ attains its **maximum** and **minimum**.
[^compact]: A set is compact if every open cover has a finite subcover. In $\\R^n$, this is equivalent to being closed and bounded.

# Blockquote

> Mathematics is the queen of the sciences and number theory is the queen of mathematics.
> — Carl Friedrich Gauss

> The identity $e^{i\\pi} + 1 = 0$ unites five constants. For any $f: [a,b] \\to \\mathbb{R}$, the integral $\\int_a^b f(x)\\,dx$ measures signed area.

---

# Background

## Compactness

The notion of compactness is central to analysis. In $\\R^n$, the Heine-Borel theorem states that a set is compact if and only if it is closed and bounded.
`,
    "refs.bib": `@article{karger2000,
  author = {David R. Karger},
  title = {Minimum Cuts in Near-Linear Time},
  journal = {Journal of the ACM},
  volume = {47},
  number = {1},
  pages = {46--76},
  year = {2000}
}

@book{cormen2009,
  author = {Thomas H. Cormen and Charles E. Leiserson and Ronald L. Rivest and Clifford Stein},
  title = {Introduction to Algorithms},
  publisher = {MIT Press},
  year = {2009},
  edition = {3rd}
}

@book{knuth1997,
  author = {Donald E. Knuth},
  title = {The Art of Computer Programming},
  publisher = {Addison-Wesley},
  year = {1997},
  volume = {1}
}
`,
    "posts/math.md": `# Relative Image Fixture

This file exercises document-relative image resolution from a nested path.

![Tiny nested image](diagram.png)
`,
    "posts/diagram.png": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0ioAAAAASUVORK5CYII=",
    "notes.md": `# Research Notes

## Open Problems

- Can we achieve $O(n \\log n)$ minimum cut?
- Derandomization of Karger's algorithm
- Extension to **weighted** graphs

## Reading List

1. @karger2000 — the foundational paper
2. @cormen2009 — Chapter 26 on maximum flow
3. [@knuth1997] — Volume 1, fundamental algorithms
`,
    "chapters/introduction.md": `# Introduction

This document demonstrates the shared Coflat format for mathematical writing. The editor provides:

- **Rich editing**: CM6 reveals markdown source on focus while keeping a Typora-style rendered view
- **KaTeX math**: inline $x^2$ and display mode with equation labels
- **Theorem environments**: fenced divs with automatic numbering
- **Cross-references**: click-to-navigate between theorems, equations, and citations
- **CSL citations**: formatted bibliography from BibTeX files
`,
    "chapters/diagram.png": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0ioAAAAASUVORK5CYII=",
    "chapters/background.md": `# Background

## Compactness

The notion of compactness is central to analysis. In $\\R^n$, the Heine-Borel theorem states that a set is compact if and only if it is closed and bounded.

::: {.theorem #thm-heine-borel title="Heine-Borel"}
A subset of $\\R^n$ is compact if and only if it is closed and bounded.
:::

## Continuity

::: {.definition #def-continuous title="Continuity of $f: X \\to Y$"}
A function $f$ is **continuous** at $x_0$ if for every $\\varepsilon > 0$ there exists $\\delta > 0$ such that $d(x, x_0) < \\delta$ implies $d(f(x), f(x_0)) < \\varepsilon$.
:::

This is equivalent to requiring that preimages of open sets are open.
`,
};
