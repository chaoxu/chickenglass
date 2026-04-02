---
title: Regression Suite
bibliography: reference-autocomplete.bib
---

# Math

Inline math such as $x^2 + y^2 = z^2$ should render in rich mode.

## Quadratic Integral

$$
\int_0^1 x^2 \, dx = \frac{1}{3}
$$ {#eq:quadratic-integral}

# Cross-References

:::: {#thm:extreme .theorem} Extreme Value Theorem
Every continuous function on a compact interval attains a maximum.
::::

:::: {#def:compactness .definition} Compactness
A closed interval $[a, b]$ is compact.
::::

See [@thm:extreme], [@def:compactness], and [@eq:quadratic-integral].

# Citations

See [@karger2000] for details and [@stein2001, Ch. 2] for a textbook treatment.

# Sidenotes

This paragraph carries a footnote[^suite-note] so the sidenote widgets render.

[^suite-note]: Sidenote bodies should support inline math such as $x^2$.

# Tables

| Feature | Status | Notes |
| --- | --- | --- |
| Headings | stable | Section numbers should stay visible |
| Crossrefs | stable | Rich mode should render targets |
| Tables | stable | Pipe tables become rich grids |

# Code Blocks

```ts
function isPrime(n: number): boolean {
  if (n < 2) return false;
  for (let i = 2; i * i <= n; i += 1) {
    if (n % i === 0) return false;
  }
  return true;
}
```
