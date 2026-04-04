---
title: Hover Preview Fixture
numbering: global
---

See [@tbl:hover], [@tbl:wide], [@thm:hover-code], [@fig:hover], and [@fig:missing].

::: {.table #tbl:hover} Results table

| A | B |
| --- | --- |
| 1 | 2 |

:::

::: {.table #tbl:wide} Wide table preview

| identifier_with_no_breaks_aaaaaaaaaaaaaaaa | identifier_with_no_breaks_bbbbbbbbbbbbbbbb | identifier_with_no_breaks_cccccccccccccccc |
| --- | --- | --- |
| value_with_no_breaks_11111111111111111111 | value_with_no_breaks_22222222222222222222 | value_with_no_breaks_33333333333333333333 |

:::

::: {.theorem #thm:hover-code} Wide code preview

```typescript
const veryLongIdentifierWithoutAnyBreaks = "abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz";
```

:::

::: {.figure #fig:hover} Preview figure

![Preview image](hover-preview-figure.png)

:::

::: {.figure #fig:missing} Missing preview

![Missing image](missing-preview.pdf)

:::
