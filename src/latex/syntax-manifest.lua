-- Canonical LaTeX-export view of the Coflat syntax manifest.
--
-- Keep this file synchronized with src/constants/block-manifest.ts. The
-- companion syntax-manifest.test.ts fails when the TypeScript manifest drifts.

return {
  xref_prefixes = {
    sec = true,
    eq = true,
    thm = true,
    lem = true,
    cor = true,
    prop = true,
    def = true,
    fig = true,
    tbl = true,
    alg = true,
  },

  latex_environment_by_block = {
    theorem = "theorem",
    lemma = "lemma",
    corollary = "corollary",
    proposition = "proposition",
    conjecture = "conjecture",
    definition = "definition",
    problem = "problem",
    proof = "proof",
    remark = "remark",
    example = "example",
  },

  latex_kind_by_block = {
    theorem = "environment",
    lemma = "environment",
    corollary = "environment",
    proposition = "environment",
    conjecture = "environment",
    definition = "environment",
    problem = "environment",
    proof = "environment",
    remark = "environment",
    example = "environment",
    algorithm = "algorithm",
    figure = "figure",
    table = "table",
    blockquote = "blockquote",
  },
}
