# Export Contract

Pandoc export flags, template names, resource-path ordering, and format-specific
tool dependencies are owned by `src/latex/export-contract.json`.

Update that contract first when changing LaTeX, PDF, or HTML export behavior.
The JavaScript export helpers, CLI/perf harnesses, and the Rust Tauri backend
render their Pandoc arguments from the same contract. Keep path resolution and
preprocessing code in the caller, but do not add fixed Pandoc flags directly to
`scripts/export-*`, `scripts/perf-regression.mjs`, or
`src-tauri/src/commands/export.rs`.
