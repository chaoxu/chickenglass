# Inline Rendering Policy

Inline formatting is derived from canonical markdown text and must stay stable
across:

- the Lexical editing surface
- source mode
- HTML/export consumers
- indexing and diagnostics

Rules:

- KaTeX renders math, but math delimiters and labels must round-trip exactly.
- Bold/italic/code/strike/highlight/link transforms must rewrite markdown, not store hidden rich-only state.
- Frontmatter, references, equation labels, and fenced-div metadata are semantic markdown features, not presentational sugar.
- If an inline behavior is ambiguous, the `FORMAT.md` round-trip contract wins.
