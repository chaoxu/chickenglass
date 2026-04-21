# Development Rules

## Subsystem pattern

- For any non-trivial feature, use the subsystem pattern in `docs/architecture/subsystem-pattern.md`.
- A complex feature should usually have explicit model, controller, render adapter, side-effect, and invariant-test seams.
- One concept should have one clear owner. Avoid splitting the same policy across unrelated files.
- When a new subsystem owner exists, remove stale legacy paths instead of keeping both.

## Default rigor mode

- Unless the user explicitly asks for a quick patch, brainstorming only, or issue-only investigation, default to rigorous implementation.
- Start with root-cause analysis, not symptom patching.
- Prefer the smallest clean fix at the correct architectural layer over local hacks.
- Check adjacent cases and duplicated code paths, not just the exact repro.
- Add regression coverage for the bug class when feasible, not only the single example.
- Run targeted verification before claiming fixed.
- Do a self-review/simplification pass before commit.
- If the architecture is wrong, say so and fix that instead of preserving a bad shape.

## Editor Surface Ownership

- Coflats has one app shell with runtime editor modes: CM6 rich, Lexical WYSIWYG, and CM6 source.
- App-shell features should be shared unless they truly depend on one editor surface.
- Prefer surface-neutral bridges and types (`__editor`, app hooks, shared semantic stores) when code or tests need to work in both editor surfaces.
- Keep CM6-only rules in `src/editor`, `src/render`, CM6 state modules, and CM6 regression scripts. Keep Lexical-only rules in `src/lexical` and Lexical smoke/regression paths.
- Do not describe markdown as the only in-memory source of truth for Lexical. In Lexical mode, markdown is the load/save serialization boundary.

### Rigor prompt patterns

- `Be rigorous. Don't stop at the first fix.`
- `Do root-cause analysis first, then implement.`
- `Treat this like a refactor, not a patch.`
- `I care more about correctness than speed.`
- `Review your own change before committing.`
- `Add regression tests for the bug class, not just the exact repro.`
- `Check for adjacent cases and duplicates in the codebase.`
- `If the architecture is wrong, say so and fix that instead.`

## CM6 Typora-style editing

- Content keeps its natural font when editing (code stays monospace, prose stays serif).
- Opening fence shows as source when cursor is on it; closing fence is always hidden (zero height, protected by transaction filter, cursor skips via atomicRanges).
- Rich and Read mode must look the same (same CSS classes/properties).
- Never hide source the user is editing.
- **Block headers must behave like headings (CRITICAL -- regressed 3+ times):**
  - `Decoration.replace` covers ONLY the fence prefix (`::: {.class}` -> `titleFrom`), NOT the title text.
  - The widget shows only the label ("**Theorem 1.**" + separator), not the title.
  - Title text (`titleFrom` -> `titleTo`) stays as normal editable document content.
  - Inline render plugins (math, bold, italic) handle title content naturally -- `$x^2$` renders as KaTeX.
  - When cursor is on either fence: fence prefix becomes source (`::: {.theorem}`), but title text stays rendered. Only direct cursor contact on `$x^2$` makes it source.
  - When cursor is off both fences: widget replaces fence prefix with rendered label.
  - NEVER replace the full line (`openFenceFrom` -> `titleTo`) with a single widget -- this kills inline rendering in source mode.
  - No-title case: widget replaces `openFenceFrom` -> `openFenceTo` (nothing to split).

## CM6 decoration rules

- `Decoration.line` for inherited CSS (font-size, line-height). `Decoration.mark` for text-only (font-weight, color).
- `Decoration.replace` + `ignoreEvent() { return true }` + mousedown handler dispatching to `sourceFrom` for widgets.
- Never extend `Decoration.replace` over user-editable text -- edits get swallowed.
- Never use `ignoreEvent() { return false }` with custom mousedown handlers.

## Geometry ownership

- CM6 owns the vertical geometry of editor content. Do not use CSS to change `.cm-line` height/flow behind CM6's back.
- In particular, avoid geometry hacks on CM6-owned lines such as `line-height: 0`, hiding `.cm-widgetBuffer`, negative margins, transforms, or absolute positioning that changes effective block height.
- If something is visually a block, model it as a CM6 block widget/replacement instead of coercing inline content into block layout with CSS selectors.
- If a widget's height can change after mount, trigger `requestMeasure()` from the code path that changes it.
- Style inside the widget is fine. Reinterpreting the surrounding editor line layout in CSS is not.

## Lezer parser rules

- Prefer Lezer tree walking over regex for markdown/document parsing. If the task is really about document structure, syntax, or block boundaries, use the syntax tree.
- `endLeaf` callbacks for paragraph interruption (display math after text without blank line).
- Fenced div composite blocks use a generation counter in the `value` parameter to prevent incremental parser fragment reuse (see `packValue` in fenced-div.ts).
- Block parsers using `cx.nextLine()` inside a composite must check for `:::` closing fences to avoid crossing composite boundaries (see `isClosingFence` in fenced-div.ts).
- Guard `closeFenceNode.from` against out-of-range positions -- incomplete trees can have `-1`.

## Testing

- ALWAYS test before claiming fixed. Use the managed browser harness when possible. For product-neutral checks, use `__editor` and `__app`; for CM6-only investigations, use `pnpm dev` + `pnpm chrome` + `__cmDebug.dump()`; for Coflat 2 checks, use `pnpm dev:coflat2` + `pnpm test:browser:coflat2`. Never ask the user to test unless it's something you literally cannot test (e.g., native OS interactions).
- Always open `index.md` in the browser to verify rendering. It opens by default on startup. If a feature you changed is not covered by `index.md`, add a test case to it.
- **Visual changes require browser verification before closing an issue.** Any change that affects CSS, rendering, decorations, themes, or layout MUST be verified in the live browser (via CDP) before closing the issue or claiming it's fixed. If browser verification is not possible, explicitly alert the user that visual verification was not done. Never close a visual issue based only on "build passes" or "tests pass."
- Test StateFields without a browser: `EditorState.create({extensions}).update({changes}).state.field(myField)`.
- For parser bugs, write a Vitest test with the exact document content first, then check browser for incremental parsing issues.

## Shell/CLI text safety

- Do not inline long natural-language text directly in shell commands when it contains quotes, backticks, or `$`.
- For GitHub comments, commit messages, or other multi-sentence CLI text, prefer stdin, a quoted here-doc, or a temp file (`--body-file`, `--comment-file`) over shell interpolation.
- Short literal commands can stay inline; human prose should usually go through a file.

## Error handling policy

- User-initiated operations should throw or return a structured failure so the UI can surface the error.
- System-level parsing/loading that can degrade safely may return empty/default values, but that fallback should be intentional and documented.
- Async background tasks that dispatch into CM6 must use a connected-view guard (for example `dispatchIfConnected`) so teardown races become noops instead of noisy exceptions.
- Never use bare `catch {}` without an explicit reason; at minimum, decide whether the error is expected, should be logged, or should be surfaced.

## Workflow gates

- **Reviewer/simplifier gate before every commit**: Before `git commit`, ALWAYS launch `pr-review-toolkit:code-reviewer` and `pr-review-toolkit:code-simplifier` in parallel on the diff. Apply findings. Then commit once, clean. Not optional. Subagents use `Skill tool` for the same gates and loop until both pass.
- **Issue tracking uses Gitea** (`tea` CLI). Forge at `http://localhost:3001`, repo `chaoxu/coflat`. Use `tea issue list`, `tea issue close N`, etc. GitHub mirror kept as `github` remote.
- **Closure gate before every issue close** (`tea issue close`): Two PreToolUse hooks enforce this:
  1. `closure-gate.sh` -- blocks issue close unless `.claude/state/closure-verified-N` exists AND contains valid JSON with `{"verdict": "COMPLETE", "criteria": [...]}`. The marker is consumed on close.
  2. `closure-marker-guard.sh` -- blocks any Bash command that touches `closure-verified` files. Markers can only be created via the Write tool by a completeness review agent.
  - The completeness review agent must write the marker with structured JSON after verifying all acceptance criteria in the actual codebase.
  - **After every fix round, re-run the completeness review.** Never close based on fix worker self-reports alone. The review->fix->review loop continues until the review returns COMPLETE or retries are exhausted.

## Miscellaneous

- **Copy what works**: Study existing open-source projects before implementing. Reference repos: [codemirror-rich-markdoc](https://github.com/segphault/codemirror-rich-markdoc), [obsidian-codemirror-options](https://github.com/nothingislost/obsidian-codemirror-options), [advanced-tables-obsidian](https://github.com/tgrosinger/advanced-tables-obsidian).
- **Use Context7**: Fetch up-to-date API docs before implementing with any library.
- **Wire features into the app**: Every feature must be connected to the editor entry point, not just exported.
