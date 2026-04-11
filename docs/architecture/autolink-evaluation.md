# LexicalAutoLinkPlugin evaluation

Issue: #64

## What it does

`AutoLinkPlugin` (from `@lexical/react/LexicalAutoLinkPlugin`) uses
`registerAutoLink` from `@lexical/link` to register a TextNode transform that
scans text content for URL patterns and replaces matches with `AutoLinkNode`.

Key props:

- `matchers: Array<LinkMatcher>` -- functions that receive a text string and
  return `{ index, length, text, url }` or null. No default matchers are
  provided; the consumer must supply them.
- `excludeParents?: Array<(parent: ElementNode) => boolean>` -- predicates that
  skip auto-linking inside specific parent node types.
- `onChange?: ChangeHandler` -- notified when a link is created or removed.

`createLinkMatcherWithRegExp(regExp, urlTransformer?)` is a helper to build a
matcher from a regex.

## coflat's current approach

coflat already has:

- **`AutoLinkNode`** registered via `@lexical/link` -- used in
  `LinkSourcePlugin` and the markdown bridge.
- **`LinkPlugin`** from `@lexical/react/LexicalLinkPlugin` -- already mounted
  in `LexicalRichMarkdownEditor`.
- **`ClickableLinkPlugin`** from `@lexical/react/LexicalClickableLinkPlugin`
  -- already mounted in the editor.
- **`LinkSourcePlugin`** -- custom plugin that opens a floating editor on click,
  already handles `$isAutoLinkNode` for editing existing auto-links.

coflat does **not** currently auto-detect URLs in text. Links come from markdown
parsing (`[text](url)` and bare URLs parsed by the markdown bridge).

## Safety analysis for math and citations

coflat's custom inline content that must not be auto-linked:

1. **Inline math** (`$...$`, `\(...\)`) -- stored as `InlineMathNode`
   (DecoratorNode). Since decorator nodes are not `TextNode`, the auto-link
   transform would never see their content. **Safe by design.**

2. **Citations** (`@id`) -- stored as `ReferenceNode` (DecoratorNode). Same as
   math: decorator nodes are invisible to TextNode transforms. **Safe by
   design.**

3. **Code blocks** -- stored as `CodeNode` from `@lexical/code`. The transform
   runs on TextNode, but code block text nodes are children of `CodeNode`.
   An `excludeParents` predicate for `$isCodeNode` would prevent auto-linking
   inside code. **Safe with one predicate.**

4. **Table cells** -- may contain URLs that should be auto-linked. No exclusion
   needed for coflat's custom `TableCellNode`.

## Evaluation

### Positives

- Uses the standard TextNode transform pattern (documentation-first approach).
- `excludeParents` provides clean exclusion for code blocks.
- Math and citation content is inherently safe because decorator nodes are not
  TextNodes.
- `createLinkMatcherWithRegExp` makes defining URL patterns straightforward.
- The plugin is thin (delegates to `registerAutoLink`) and composes well.

### Concerns

1. **No current demand.** coflat's markdown bridge already converts bare URLs
   and `[text](url)` links to `LinkNode`/`AutoLinkNode` during markdown-to-
   Lexical import. Auto-link detection is only useful for URLs typed directly
   into the editor.

2. **False positive risk.** URL regex matching on academic/mathematical text
   is fragile. Strings like `x.y` or `a.b.c` can match TLD patterns. For a
   math-heavy editor, this would create spurious auto-links.

3. **Interaction with markdown bridge.** When the user types a URL and the
   auto-link transform fires, it creates an `AutoLinkNode`. On the next
   markdown sync cycle, this becomes a bare URL in markdown. When re-imported,
   it becomes an `AutoLinkNode` again. This round-trip is correct, but the
   auto-link transform fires on every keystroke during URL entry, which may
   cause flicker as the node is created/destroyed/recreated.

4. **No pressing user story.** The issue asks to evaluate fit. No user or
   issue has requested "URLs I type should auto-link." The markdown shortcut
   plugin already handles `[text](url)` expansion.

## Decision: REJECT (defer)

The plugin is well-designed and would be safe to adopt (math and citations are
inherently protected as decorator nodes). However:

- There is no current user demand for auto-link detection during editing.
- The false-positive risk on academic text outweighs the convenience.
- The markdown bridge already handles link creation from markdown syntax.

If auto-link detection becomes desired in the future, adoption would be
straightforward:

```tsx
import { AutoLinkPlugin, createLinkMatcherWithRegExp } from "@lexical/react/LexicalAutoLinkPlugin";
import { $isCodeNode } from "@lexical/code";

const URL_MATCHER = createLinkMatcherWithRegExp(
  /https?:\/\/[^\s<>[\](){}]+/,
  (text) => text,
);

<AutoLinkPlugin
  matchers={[URL_MATCHER]}
  excludeParents={[(parent) => $isCodeNode(parent)]}
/>
```

No `excludeParents` is needed for math or citations since they use decorator
nodes, not TextNode. The code-block exclusion is the only required predicate.

Revisit when there is a concrete user request for auto-link behavior.
