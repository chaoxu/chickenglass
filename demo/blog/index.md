---
title: Feature Test Page
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

::: {.theorem} Fundamental Theorem
For all $n \in \N$:
$$
\sum_{k=1}^n k^2 = \frac{n(n+1)(2n+1)}{6}
$$
:::

::: {.proof}
By induction. Base case $n=1$: $1 = \frac{1 \cdot 2 \cdot 3}{6}$. ∎
:::

::: {.proposition}
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

# Cross-References and Citations

See [@cormen2009] for details.

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

# Footnotes

This has a footnote[^1].

[^1]: This is the footnote content with math $x^2 + y^2 = r^2$.
