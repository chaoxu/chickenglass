---
title: Example Document -- Let's abandon $\LaTeX$
tags: Example
author: 
  - Lady Apple
  - Lord Apple
date: 2022-12-01
---

# Abstract

This document show off some capabilities.

******

As a mathematician, who rarely use advanced features of $\LaTeX$, there are only a few important for writing.

# Rendering $\LaTeX$ Math Mode

We can do $\LaTeX$ math rendering. Using `$`, `\[`, `$$` or whatever delimiter. 
This can be configured. I personally like to use `$` and `\[`

See $\int_{-\infty}^\infty x^2 dx$ and display math \[\int_{-\infty}^\infty x^2 dx.\]

#  Theorem environment

::: Theorem

  This is a normal theorem.

:::

However, if we need to refer to a theorem later, we would have to take extra care.

::: {.Theorem #thm:fundalgebra title="Fundamental Theorem of Algebra"}
  The field of complex numbers is algebraically closed.
:::

::: Proof
  Just check wikipedia.
:::

::: {.Theorem #thm:fundarith title="Fundamental Theorem of Arithmetic"}
  Every integer greater than $1$ can be represented uniquely as a product of prime numbers. 
:::

::: Remark
  See how we can refer to both theorems, [@thm:fundalgebra] and [@thm:fundarith].
:::

Having markdown inside title? Fine, as long as it is not too crazy. Anything inline would work.

::: {.Conjecture title="$x^2$ and reference [@aksin] allowed in title"}

  Seems like it is working.

:::

# Table

| Default | Left | Right | Center |
|---------|:-----|------:|:------:|
| 12      | 12   |    12 |   12   |
| $x^2$   | 123  |   123 |  123   |
| 1       | 1    |     1 |   1    |


# General class handling

Note we can tag everything by some class. Hence, having some consistent handling for certain classes. For example `[continuous]{.definition}`.

We define [continuous]{.definition} to be whatever.

# Algorithm block

We consider the simple algorithm description philosophy appeared in [Jeff Erickson](https://jeffe.cs.illinois.edu/)'s [`jeffe.sty`](https://jeffe.cs.illinois.edu/pubs/tex/jeffe.sty).

```{.algorithm #alg:euclidian title="Pseudocode of the Euclidean Algorithm."}
[EuclidianGCD]{.smallcaps}$(a,b)$
  while $a\neq b$
      if $a>b$
          $a\gets a-b$
      else
          $b\gets b-a$
  return a
```

And we can refer to it too! Like this: [@alg:euclidian] and @alg:euclidian.

# Citations

We can also do citations, citing one element [@westfahl:space]. How about cite two elements [@aksin; @westfahl:space].

# Footnotes

Here are some footnotes [^1].




# Section

## Subsection

### Subsubsection

#### Paragraph
Here is a paragraph, note it is pretty nice. 

##### Subparagraph 
Here is a subparagraph, yawn. 

[^1]: This is a pretty good footnote. Footnote can be in a margin too depend on the CSS I think!?