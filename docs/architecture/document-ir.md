# Document IR

`DocumentIR` is Coflat's canonical plain-data projection for non-CM6 document consumers.

## Contract

- The IR must stay plain data and CM6-free.
- The IR is derived from the Lezer tree plus Coflat's shared semantic analysis.
- Non-CM6 consumers should read the IR instead of parsing markdown structure themselves.

## Canonical pipeline

The canonical analysis pipeline now exposes both surfaces together:

```ts
type DocumentArtifacts = {
  analysis: DocumentAnalysis;
  ir: DocumentIR;
};
```

- `DocumentAnalysis` remains the incremental owner for editor-facing consumers.
- `DocumentIR` is the canonical export/AI/script shape for callers that must stay CM6-free.
- The shared builder lives under `src/ir/` and is reused by both the standalone `treeToIR()` helper and the incremental semantics pipeline.
- `getDocumentArtifacts(text, cacheKey)` is the cached CM6-free entry point. It reuses the same incremental `DocumentAnalysis` cache as index/citation callers, then rebuilds the IR projection from the current text and tree.

## Public entry points

- `analyzeDocumentArtifacts(doc, tree)` in `src/semantics/document.ts`
- `getDocumentArtifacts(text, cacheKey?)` in `src/semantics/incremental/cached-document-analysis.ts`
- `analyzeMarkdownDocument(text, cacheKey?)` in `src/semantics/markdown-analysis.ts`
- `treeToIR(tree, text)` in `src/ir/tree-to-ir.ts`
- The CM6 editor state still exposes `DocumentAnalysis` via `documentAnalysisField`; IR currently stays on the standalone helper path for non-CM6 consumers.

## Include Status

The legacy `src/plugins/include-resolver.ts` path was removed when non-Pandoc include syntax left the canonical format. There is no include-specific tree walker in the current pipeline. Legacy `.include` fenced divs flow through the same canonical fenced-div semantics as any other block, so indexing and IR consumers see the same `DocumentAnalysis.fencedDivs` / `DocumentIR.blocks` projection.

## Freshness rules

- `DocumentAnalysis` may legitimately reuse the previous analysis object when an edit does not change any semantic slices.
- `DocumentIR` must still be rebuilt from the current document text and tree, because it also includes frontmatter metadata, tables, raw fenced-div content, and section end ranges.
- Consumers must not infer IR freshness from `DocumentAnalysis` object identity alone.
