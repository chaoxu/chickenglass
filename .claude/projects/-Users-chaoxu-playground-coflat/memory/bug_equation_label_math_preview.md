---
name: bug_equation_label_math_preview
description: Equation labels ({#eq:foo}) shown inside math preview causing KaTeX errors (red) when editing labeled $$ blocks
type: project
---

When editing a labeled display math block (`$$ ... $$ {#eq:binomial}`), the math preview includes `{#eq:binomial}` as part of the LaTeX content, causing a KaTeX parse error (red text). The label should be stripped before rendering the preview.

**Why:** The math renderer or preview doesn't strip the equation label suffix before passing to KaTeX.

**How to apply:** When fixing, check `stripMathDelimiters` or the math preview path — the label `{#eq:...}` needs to be removed before KaTeX rendering. Both inline preview and the rendered widget should handle this.

**Repro:** Open index.md, find labeled `$$` block, click to edit — preview shows red error.
