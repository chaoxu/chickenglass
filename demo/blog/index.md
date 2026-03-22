---
title: "**Feature** Test Page with $x^2$ and `code`"
bibliography: reference.bib
---

This page tests all rendering features. Open it to verify everything works.

# Unnumbered Heading {-}

This heading has `{-}` — it should NOT have a section number.

# Numbered Heading

This SHOULD have section number "1".

## Unnumbered Subsection {.unnumbered}

Uses `{.unnumbered}` — also no number.

## Numbered Subsection

Should be "1.1".

# A Very Long Heading With **Bold**, `code`, $x^2$, a [link](https://example.com), and [@cormen2009] That Should Stay Readable in Breadcrumbs and Outline

This heading exists to verify:

- document-inline rendering inside the document body
- ui-chrome-inline degradation in breadcrumbs / outline / other chrome surfaces
- full breadcrumb text (no truncation)

# Inline Rendering

**Bold text**, *italic text*, ~~strikethrough~~, ==highlight==, `inline code`.

Inline math: $e^{i\pi} + 1 = 0$, $\sum_{k=1}^n k = \frac{n(n+1)}{2}$.

Mixed delimiters: $x^2$ and \(y^2\) in the same line.

# Display Math

Standard:

$$
\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}
$$

Backslash:

\[
\sum_{k=0}^n \binom{n}{k} = 2^n
\]

Display math without blank line before:
$$
a^2 + b^2 = c^2
$$

# Labeled Display Math and Equation References

Plain labeled `$$` block:

$$
\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}
$$ {#eq:gaussian}

Labeled `\[\]` block:

\[
\sum_{k=0}^n \binom{n}{k} = 2^n
\] {#eq:binomial}

Equation references should work in both bracketed and narrative forms:

- Bracketed: [@eq:gaussian], [@eq:binomial]
- Narrative: @eq:gaussian and @eq:binomial
- Clustered: [@eq:gaussian; @eq:binomial]

# Math in Lists

1. First item with inline math $O(n \log n)$
2. Display math in list:
   $$
   T(n) = 2T(n/2) + O(n)
   $$
3. Backslash display math in list:
   \[
   f(x) = \sum_{i=0}^n a_i x^i
   \]
4. Simple text item

- Bullet with math: $\R$, $\N$, $\Z$

# Math in Fenced Divs

::: {#thm:fundamental .theorem} Fundamental Theorem
For all $n \in \N$:
$$
\sum_{k=1}^n k^2 = \frac{n(n+1)(2n+1)}{6}
$$
:::

::: {.proof}
By induction. Base case $n=1$: $1 = \frac{1 \cdot 2 \cdot 3}{6}$.
:::

::: {#prop:tu .proposition}
Properties:

1. $A^T \in TU$
2. Display math in fenced div list:
   \[
   \begin{bmatrix} 0 \\ A_1 \\ A_2 \end{bmatrix} \in TU
   \]
3. Next item
:::

# Tables

| Algorithm | Time | Space |
|-----------|------|-------|
| Quicksort | $O(n \log n)$ | $O(\log n)$ |
| Mergesort | $O(n \log n)$ | $O(n)$ |

# Code Blocks

```haskell
fibonacci :: Int -> Int
fibonacci 0 = 0
fibonacci 1 = 1
fibonacci n = fibonacci (n-1) + fibonacci (n-2)
```

# Gist Embed

::: {.gist}
https://gist.github.com/chaoxu/6094392
:::

# Blockquote with Math

::: Blockquote
For any $\epsilon > 0$, there exists $\delta > 0$ such that:
$$
|x - a| < \delta \implies |f(x) - f(a)| < \epsilon
$$
:::

# Links and Images

[Link text](https://example.com) should render as underlined text, reveal source on click.

![Alt text](https://via.placeholder.com/150) should render as inline image.

# Bold in Fenced-Div Titles

::: {.theorem} **Main Result**
This theorem title should render "Main Result" in bold.
:::

::: {.problem title="**3SUM**"}
This problem title uses the `title=` attribute and should render "3SUM" in bold.
:::

# Rich Block Titles

::: {.remark} Title with [a link](https://example.com), [@cormen2009], `code`, and $x^2$
This block title should stay rich inside the document surface.
:::

# Footnotes

This has a footnote[^1] and a richer footnote[^2].

[^1]: This is the footnote content with math $x^2 + y^2 = r^2$.
[^2]: This footnote has **bold**, `code`, a [link](https://example.com), a citation [@cormen2009], and math $\alpha^2 + \beta^2 = \gamma^2$.

# Cross-References and Citations

See [@cormen2009] for details.

By [@thm:fundamental], the sum formula holds. See also [@prop:tu].

Narrative block reference: @thm:fundamental.

Reference cluster: [@thm:fundamental; @prop:tu; @eq:gaussian].

# Search Rich-Mode Coverage

Search for `SearchNeedle` and `@cormen2009`.

Plain prose SearchNeedle should highlight.

Inline math SearchNeedle: $SearchNeedle^2 + 1$.

Display math SearchNeedle:

$$
\text{SearchNeedle} = x + y
$$

::: {.definition} SearchNeedle Block Title
This block body also contains SearchNeedle and [@cormen2009].
:::

| Surface | Token |
|---------|-------|
| table cell | SearchNeedle |
| citation source | @cormen2009 |

Another SearchNeedle footnote[^search].

[^search]: SearchNeedle inside footnote tooltip and inline rendering.
