# Architecture Decisions

- Markdown text is the canonical document state.
- Lexical owns interactive editing state and DOM behavior.
- `src/lexical/` owns markdown import/export and `FORMAT.md` carryover tests.
- Analysis/indexing runs from canonical markdown text in `src/index/` and `src/app/markdown/`.
- Coflat-specific syntax stays custom at the markdown/Lexical layer; generic editor behavior should reuse Lexical packages directly.
- Export and editing are separate concerns. Exporters consume canonical markdown and theme tokens, not editor internals.
- File system and session orchestration stay in `src/app/`; standalone editor code must not depend on the app shell.
