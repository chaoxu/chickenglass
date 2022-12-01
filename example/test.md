---
title: Example Document
tags: Example
author: 
  - Lady Apple
  - Lord Apple
date: 2022-12-01
---

# Abstract

This document shows some capabilities.

******

Here is some text before the beginning.

# LaTeX

We do some LaTeX rendering. Use `$`, `\[`, `$$` or whatever delimiter. This can be configured elsewhere. The standard here is `$` and `\[`

See $\int_{-\infty}^\infty x^2 dx$ and display math \[\int_{-\infty}^\infty x^2 dx\]

#  Theorem environment

::: Theorem

  This is just a normal theorem

:::

However, if we need to refer to a theorem later, we would have to take extra care.

::: {.Theorem #thmwow title="wow"}

  This is the wow theorem.

:::

::: Proof
Here is the proof.
:::

Here we refer to [@thmwow].

These blocks are handled by theorem block handler, which is a lua filter.

# General class handling

Note we can tag everything by some class. Hence, having some consistent handling for certain classes. For example `[continuous]{.definition}`.

We define [continuous]{.definition} to be whatever.

# Citations

We can also do citations. [@ChanH20,@KargerS96]