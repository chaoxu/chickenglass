# Inline Rendering Surface Policies

Coflat uses a single Lezer markdown parser for all inline content. Rendering
behavior varies by **surface** -- the context where the inline content appears.
Three surfaces are defined, each with its own policy for which node types are
rendered, degraded, or disallowed.

## Surfaces

### `document-body`

Full document rendering. Used by the CM6 rich-mode viewport and the HTML
preview/read-mode path (`markdownToHtml`). Lexical has its own renderers, but
shared chrome callers should follow the same surface policy. All inline
and block constructs are rendered at full fidelity.

**Consumers:** `markdownToHtml()` preview/read-mode walker, CM6 ViewPlugins for
paragraphs and list items.

### `document-inline`

Inline-only rendering for document-flow surfaces that are part of the visible
document but structurally restricted to a single line. Links, citations, and
cross-references remain interactive.

**Consumers:**
- Heading text in read-mode previews (`renderHeading` in `markdown-to-html.ts`)
- Fenced div titles in read-mode previews (`renderFencedDiv` in `markdown-to-html.ts`)
- Block header widgets in rich mode (`plugin-render.ts`)
- Frontmatter title widget in rich mode (`frontmatter-state.ts`)

### `ui-chrome-inline`

Minimal rendering for UI chrome surfaces outside the document flow. Content
must be stable, single-line, and inert -- no interactive elements.

**Consumers:**
- Outline panel headings (`outline.tsx`)
- Breadcrumb labels (`breadcrumbs.tsx`)
- Tab labels (planned)
- Window title (planned)

## Node Type Policy Matrix

| Node type | `document-body` | `document-inline` | `ui-chrome-inline` |
|---|---|---|---|
| **Emphasis** (`*text*`) | `<em>` | `<em>` | `<em>` |
| **StrongEmphasis** (`**text**`) | `<strong>` | `<strong>` | `<strong>` |
| **Strikethrough** (`~~text~~`) | `<del>` | `<del>` | `<del>` |
| **Highlight** (`==text==`) | `<mark>` | `<mark>` | `<mark>` |
| **InlineCode** (`` `code` ``) | `<code>` | `<code>` | `<code>` |
| **InlineMath** (`$x^2$`) | KaTeX rendered | KaTeX rendered | KaTeX rendered |
| **Escape** (`\*`) | text (backslash stripped) | text (backslash stripped) | text (backslash stripped) |
| **Link** (`[text](url)`) | `<a href>` | `<a href>` | **degraded**: text only, no anchor |
| **Image** (`![alt](src)`) | `<img>` | **degraded**: alt text only | **degraded**: alt text only |
| **CrossRef** (`[@id]`) | `<a class="cross-ref">` | `<a class="cross-ref">` | **degraded**: inert text |
| **Citation** (`[@key]`) | `<span class="cf-citation">` | `<span class="cf-citation">` | **degraded**: inert text |
| **FootnoteRef** (`[^1]`) | `<sup><a>` (linked) | `<sup><a>` (linked) | **degraded**: `<sup>` (inert, no link) |
| **HardBreak** | `<br>` | space | space |
| **URL** (bare, inside links) | skipped (handled by Link) | skipped | skipped |
| **Raw HTML** | not parsed (Lezer strips) | not parsed | not parsed |

### Degradation definitions

- **Rendered**: Full interactive or visual representation.
- **Degraded**: Content is present but simplified. Links lose their `<a>`
  wrapper, images collapse to alt text, citations/cross-refs become plain
  text, footnote refs lose their anchor.
- **Disallowed/Flattened**: Content is stripped or replaced with minimal text.
  Currently no node types are fully stripped -- all degraded nodes preserve
  their text content.

## API

### Type definitions (`src/inline-surface.ts`)

```ts
/** Public inline rendering surfaces shared across title-like and UI chrome views. */
export type InlineRenderSurface = "document-inline" | "ui-chrome-inline";
```

`"document-body"` is not part of `InlineRenderSurface` because it is the
default full-rendering mode. Both renderers define a union type internally:

```ts
// src/render/inline-render.ts (DOM renderer)
type DomInlineSurface = InlineRenderSurface | "document-body";

// src/app/markdown-to-html.ts (HTML string renderer)
type HtmlInlineSurface = InlineRenderSurface | "document-body";
```

### DOM renderer (`src/render/inline-render.ts`)

```ts
export function renderInlineMarkdown(
  container: HTMLElement,
  text: string,
  macros?: Record<string, string>,
  surface?: DomInlineSurface,  // defaults to "document-body"
): void;
```

Used by CM6 widgets that need to render inline markdown into a DOM element
(block header labels, frontmatter title, sidenote margin, footnote section).

### HTML string renderer (`src/app/markdown-to-html.ts`)

```ts
export function renderInline(
  text: string,
  macros?: Record<string, string>,
  surface?: HtmlInlineSurface,  // defaults to "document-body"
): string;
```

Used by preview surfaces and React components that set
`dangerouslySetInnerHTML` (outline, breadcrumbs).

### Policy selection helper (`src/inline-surface.ts`)

```ts
export function isUiChromeInline(surface: InlineRenderSurface): boolean;
```

Returns `true` when a surface should degrade rich inline content into inert
chrome-safe text. Used internally by both renderers.

## Design principles

1. **One parser, multiple policies.** All surfaces parse with the same Lezer
   markdown pipeline and extension set. The policy layer decides what to
   render, degrade, or flatten -- never the parser.

2. **Degradation is surface-dependent, not node-dependent.** A link inside a
   heading remains a real `<a>` in `document-inline` but becomes inert text
   when the same heading content is projected into breadcrumbs under
   `ui-chrome-inline`.

3. **No ad hoc inline subsets.** Every surface opts into one of the three
   defined policies rather than inventing its own allowlist. New UI surfaces
   should choose the appropriate tier.

4. **Text content is always preserved.** Even when a node is degraded, its
   text content (link text, alt text, citation key) is still rendered. Nothing
   is silently dropped.

5. **`document-body` is the default.** Callers that do not specify a surface
   get full rendering. Restricted surfaces must opt in explicitly.
