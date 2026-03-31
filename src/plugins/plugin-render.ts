/**
 * CM6 decoration provider for rendering fenced divs using the block plugin system.
 *
 * For each FencedDiv node in the syntax tree:
 * - If a plugin is registered for its class, render using CSS marks and line
 *   decorations (Typora-style: hide syntax, show block label via ::before).
 * - If no plugin is registered, render as a plain styled div.
 *
 * Uses Decoration.mark to hide fence syntax and Decoration.line with
 * data-block-label for the rendered header. The DOM structure never changes
 * between source and rendered mode — only CSS classes are toggled.
 *
 * Uses a StateField (not ViewPlugin) so that line decorations (Decoration.line)
 * are permitted by CM6.
 */

import {
  type DecorationSet,
  Decoration,
} from "@codemirror/view";
import { EditorState, type Extension, type Range } from "@codemirror/state";
import type { BlockAttrs } from "./plugin-types";
import { pluginRegistryField, getPluginOrFallback } from "./plugin-registry";
import { blockCounterField, type BlockCounterState } from "./block-counter";
import {
  createSimpleTextWidget,
  decorationHidden,
  editorFocusField,
  focusTracker,
  hideMultiLineClosingFence,
  MacroAwareWidget,
  RenderWidget,
  addMarkerReplacement,
  pushWidgetDecoration,
  addSingleLineClosingFence,
  buildFencedBlockDecorations,
  createFencedBlockDecorationField,
  mathMacrosField,
} from "../render/render-core";
import { renderDocumentFragmentToDom } from "../document-surfaces";
import { documentSemanticsField } from "../semantics/codemirror-source";
import {
  isValidEmbedUrl,
  extractYoutubeId,
  youtubeEmbedUrl,
  gistEmbedUrl,
} from "./embed-plugin";
import { CSS } from "../constants/css-classes";
import { EXCLUDED_FROM_FALLBACK } from "../constants/block-manifest";
import { IFRAME_MAX_ATTEMPTS, IFRAME_POLL_INTERVAL_MS } from "../constants/timing";
import { collectFencedDivs, type FencedDivInfo, fenceProtectionExtension } from "./fence-protection";

/** Pre-created mark decoration for monospace source syntax on fence lines. */
const blockSourceMark = Decoration.mark({ class: CSS.blockSource });

const openParenWidget = Decoration.widget({
  widget: createSimpleTextWidget("span", CSS.blockTitleParen, "("),
  side: -1,
});
const closeParenWidget = Decoration.widget({
  widget: createSimpleTextWidget("span", CSS.blockTitleParen, ")"),
  side: 1,
});

/** Widget that renders a block header string with inline math/bold/italic. */
class BlockHeaderWidget extends MacroAwareWidget {
  constructor(
    private readonly header: string,
    private readonly macros: Record<string, string>,
  ) {
    super(macros);
  }

  createDOM(): HTMLElement {
    return this.createCachedDOM(() => {
      const el = document.createElement("span");
      el.className = CSS.blockHeaderRendered;
      renderDocumentFragmentToDom(el, {
        kind: "block-title",
        text: this.header,
        macros: this.macros,
      });
      return el;
    });
  }

  eq(other: BlockHeaderWidget): boolean {
    return this.header === other.header && this.macrosKey === other.macrosKey;
  }

  updateDOM(dom: HTMLElement): boolean {
    dom.textContent = "";
    renderDocumentFragmentToDom(dom, {
      kind: "block-title",
      text: this.header,
      macros: this.macros,
    });
    // Refresh source-range metadata so search-highlight reads correct positions
    this.setSourceRangeAttrs(dom);
    return true;
  }
}

export { BlockHeaderWidget as _BlockHeaderWidgetForTest };

class BlockCaptionWidget extends MacroAwareWidget {
  constructor(
    private readonly header: string,
    private readonly title: string,
    private readonly macros: Record<string, string>,
  ) {
    super(macros);
  }

  createDOM(): HTMLElement {
    return this.createCachedDOM(() => {
      const el = document.createElement("div");
      el.className = "cf-block-caption";

      const headerEl = document.createElement("span");
      headerEl.className = CSS.blockHeaderRendered;
      renderDocumentFragmentToDom(headerEl, {
        kind: "block-title",
        text: this.header,
        macros: this.macros,
      });
      el.appendChild(headerEl);

      if (this.title) {
        const titleEl = document.createElement("span");
        titleEl.className = "cf-block-caption-text";
        renderDocumentFragmentToDom(titleEl, {
          kind: "block-title",
          text: this.title,
          macros: this.macros,
        });
        el.appendChild(titleEl);
      }

      return el;
    });
  }

  eq(other: BlockCaptionWidget): boolean {
    return (
      this.header === other.header &&
      this.title === other.title &&
      this.macrosKey === other.macrosKey
    );
  }
}

export { BlockCaptionWidget as _BlockCaptionWidgetForTest };

/**
 * Widget that renders an attribute-only title (title="..." in the attributes,
 * no inline title text in the document).
 *
 * Unlike inline titles that stay as editable document content, attribute titles
 * live inside the attribute string and have no document range. They are rendered
 * as a widget with parentheses, matching how inline titles appear visually.
 * Inline formatting (bold, math, etc.) is supported via renderDocumentFragmentToDom.
 */
class AttributeTitleWidget extends MacroAwareWidget {
  constructor(
    private readonly title: string,
    private readonly macros: Record<string, string>,
  ) {
    super(macros);
  }

  createDOM(): HTMLElement {
    return this.createCachedDOM(() => {
      const el = document.createElement("span");
      el.className = CSS.blockAttrTitle;

      const openParen = document.createElement("span");
      openParen.className = CSS.blockTitleParen;
      openParen.textContent = "(";
      el.appendChild(openParen);

      const titleContent = document.createElement("span");
      renderDocumentFragmentToDom(titleContent, {
        kind: "block-title",
        text: this.title,
        macros: this.macros,
      });
      el.appendChild(titleContent);

      const closeParen = document.createElement("span");
      closeParen.className = CSS.blockTitleParen;
      closeParen.textContent = ")";
      el.appendChild(closeParen);

      return el;
    });
  }

  eq(other: AttributeTitleWidget): boolean {
    return this.title === other.title && this.macrosKey === other.macrosKey;
  }
}

/**
 * Compute the iframe src URL for an embed block.
 *
 * Returns undefined if the URL is invalid or cannot be embedded.
 */
function computeEmbedSrc(
  embedType: string,
  rawUrl: string,
): string | undefined {
  const url = rawUrl.trim();
  if (!isValidEmbedUrl(url)) return undefined;

  switch (embedType) {
    case "youtube": {
      const videoId = extractYoutubeId(url);
      return videoId ? youtubeEmbedUrl(videoId) : undefined;
    }
    case "gist":
      return gistEmbedUrl(url);
    case "embed":
    case "iframe":
    default:
      return url;
  }
}

/**
 * Try to read the iframe's content height and apply it.
 *
 * Returns `"resized"` on success, `"unavailable"` if the body isn't ready,
 * or `"blocked"` if cross-origin restrictions prevent access.
 */
function tryResizeIframe(
  iframe: HTMLIFrameElement,
): "resized" | "unavailable" | "blocked" {
  try {
    const doc = iframe.contentDocument;
    if (doc?.body) {
      const height = doc.body.scrollHeight;
      if (height > 0) {
        iframe.style.height = `${height}px`;
        return "resized";
      }
    }
    return "unavailable";
  } catch {
    // best-effort: cross-origin iframe blocks contentDocument access
    return "blocked";
  }
}

/**
 * Auto-resize a gist iframe to match its content height.
 *
 * Attempts to read `contentDocument.body.scrollHeight` (works when
 * same-origin or sandbox allows access). If cross-origin blocks access,
 * stops immediately. Otherwise polls until content is ready.
 */
function autoResizeGistIframe(iframe: HTMLIFrameElement): void {
  const result = tryResizeIframe(iframe);
  if (result !== "unavailable") return;

  // Content not ready yet — poll until it loads or we give up
  let attempts = 0;

  const poll = (): void => {
    attempts++;
    const r = tryResizeIframe(iframe);
    if (r === "unavailable" && attempts < IFRAME_MAX_ATTEMPTS) {
      setTimeout(poll, IFRAME_POLL_INTERVAL_MS);
    }
  };

  setTimeout(poll, IFRAME_POLL_INTERVAL_MS);
}

export function embedSandboxPermissions(embedType: string): string {
  if (embedType === "youtube") {
    return "allow-scripts allow-presentation";
  }
  return "allow-scripts";
}

/** Widget that renders an iframe for embed blocks. */
class EmbedWidget extends RenderWidget {
  constructor(
    private readonly src: string,
    private readonly embedType: string,
  ) {
    super();
  }

  createDOM(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = CSS.embed(this.embedType);

    const iframe = document.createElement("iframe");
    iframe.src = this.src;
    iframe.setAttribute("sandbox", embedSandboxPermissions(this.embedType));
    iframe.setAttribute("loading", "lazy");
    iframe.setAttribute("referrerpolicy", "no-referrer");
    iframe.setAttribute("frameborder", "0");

    if (this.embedType === "youtube") {
      iframe.setAttribute("allowfullscreen", "");
      iframe.className = CSS.embedYoutubeIframe;
    } else {
      iframe.className = CSS.embedIframe;
    }

    // Gist embeds: auto-resize iframe to match content height
    if (this.embedType === "gist") {
      iframe.addEventListener("load", () => {
        autoResizeGistIframe(iframe);
      });
    }

    wrapper.appendChild(iframe);
    return wrapper;
  }

  eq(other: EmbedWidget): boolean {
    return this.src === other.src && this.embedType === other.embedType;
  }
}


/** Hide all fence syntax for include blocks so content flows seamlessly. */
function addIncludeDecorations(
  div: FencedDivInfo,
  items: Range<Decoration>[],
): void {
  // Hide the entire opening fence line
  items.push(decorationHidden.range(div.openFenceFrom, div.openFenceTo));
  if (div.attrFrom !== undefined && div.attrTo !== undefined) {
    items.push(decorationHidden.range(div.attrFrom, div.attrTo));
  }
  if (div.titleFrom !== undefined && div.titleTo !== undefined) {
    items.push(decorationHidden.range(div.titleFrom, div.titleTo));
  }
  // Hide closing fence
  if (div.closeFenceFrom >= 0 && div.closeFenceTo > div.closeFenceFrom) {
    items.push(decorationHidden.range(div.closeFenceFrom, div.closeFenceTo));
  }
  // Collapse fence lines to zero height
  items.push(
    Decoration.line({ class: CSS.includeFence }).range(div.openFenceFrom),
  );
  if (div.closeFenceFrom >= 0) {
    items.push(
      Decoration.line({ class: CSS.includeFence }).range(div.closeFenceFrom),
    );
  }
}

/** Replace the opening fence+attrs with a rendered header widget. */
/**
 * Add header widget decoration using the heading-like marker replacement pattern.
 *
 * CRITICAL: The widget replaces ONLY the fence prefix ("::: {.class}"), NOT the
 * title text. Title text stays as editable content where inline plugins (math,
 * bold, etc.) render naturally. See addMarkerReplacement() and CLAUDE.md
 * "Block headers must behave like headings."
 *
 * DO NOT change replaceEnd to titleTo — this kills inline rendering and has
 * regressed 3+ times.
 */
function addHeaderWidgetDecoration(
  div: FencedDivInfo,
  header: string,
  cursorInside: boolean,
  macros: Record<string, string>,
  items: Range<Decoration>[],
): void {
  // Replace only the fence prefix, leave title text as editable content.
  // No-title case: replaceEnd = openFenceTo (whole fence line, nothing to split).
  // With-title case: replaceEnd = titleFrom (stop before title text).
  const replaceEnd = div.titleFrom ?? div.openFenceTo;
  const widget = header ? new BlockHeaderWidget(header, macros) : null;
  addMarkerReplacement(div.openFenceFrom, replaceEnd, cursorInside, widget, items);
}

/** Replace embed block body content with an iframe widget. */
function addEmbedWidget(
  state: EditorState,
  div: FencedDivInfo,
  openLine: { to: number },
  items: Range<Decoration>[],
): void {
  if (div.singleLine || div.closeFenceFrom < 0) return;

  const bodyFrom = openLine.to + 1; // start of first body line
  const bodyTo = div.closeFenceFrom - 1; // end of last body line (before newline)
  if (bodyFrom > bodyTo) return;

  const bodyText = state.sliceDoc(bodyFrom, bodyTo);
  const rawUrl = bodyText.trim();
  const src = computeEmbedSrc(div.className, rawUrl);
  if (src) {
    pushWidgetDecoration(items, new EmbedWidget(src, div.className), bodyFrom, bodyTo);
  }
}

/** Add right-aligned QED tombstone on the last content line of proof blocks. */
function addQedDecoration(
  state: EditorState,
  div: FencedDivInfo,
  items: Range<Decoration>[],
): void {
  if (div.closeFenceFrom < 0) return;

  const closeLine = state.doc.lineAt(div.closeFenceFrom);
  if (closeLine.number > 1) {
    const lastContentLine = state.doc.line(closeLine.number - 1);
    if (lastContentLine.from > div.openFenceFrom) {
      items.push(
        Decoration.line({ class: CSS.blockQed }).range(lastContentLine.from),
      );
    }
  }
}

/**
 * Build decorations for all fenced divs using the plugin registry.
 *
 * Each fence (opening and closing) is independently toggled between
 * rendered and source mode based on cursor position. Touching one
 * block's fence never affects any other block's decorations.
 */
function buildBlockDecorations(state: EditorState): DecorationSet {
  const registry = state.field(pluginRegistryField);
  const counterState: BlockCounterState | undefined =
    state.field(blockCounterField, false) ?? undefined;
  const macros = state.field(mathMacrosField);
  const cursor = state.selection.main;

  const baseDecos = buildFencedBlockDecorations(state, collectFencedDivs, ({
    state,
    block: div,
    focused,
    cursorOnEitherFence,
  }, items) => {
    const plugin = getPluginOrFallback(registry, div.className);

    // Include blocks are always invisible — content flows seamlessly
    if (EXCLUDED_FROM_FALLBACK.has(div.className)) {
      addIncludeDecorations(div, items);
      return;
    }

    if (!plugin) return;

    const isEmbed = plugin.specialBehavior === "embed";

    // Embed blocks: cursor inside → full source mode (all fences visible)
    if (isEmbed) {
      const cursorInsideBlock =
        focused && cursor.from >= div.from && cursor.from <= div.to;
      if (cursorInsideBlock) {
        items.push(
          Decoration.line({
            class: `${plugin.render({ type: div.className }).className} ${CSS.blockSource}`,
          }).range(div.from),
        );
        return;
      }
    }

    const numberEntry = counterState?.byPosition.get(div.from);
    const labelAttrs: BlockAttrs = {
      type: div.className,
      id: div.id,
      title: div.title,
      number: numberEntry?.number,
    };
    const spec = plugin.render(labelAttrs);
    const captionBelow = plugin.captionPosition === "below";
    const inlineHeader = plugin.headerPosition === "inline";

    // --- Opening fence ---
    // Heading-like pattern: ALWAYS apply block styling, toggle marker visibility.
    // The widget replaces only the fence prefix (::: {.class}), NOT the title text.
    // Title text stays as editable content — inline plugins render math/bold/etc.
    // See CLAUDE.md "Block headers must behave like headings."
    //
    // When in source mode, cf-block-source is a MARK decoration on the fence
    // syntax only ("::: {.class}"), NOT a line decoration. This keeps the title
    // text in its natural serif font — only syntax scaffolding gets monospace.
    //
    // displayHeader === false (e.g. blockquote): omit cf-block-header so the
    // opening fence line has no rendered label. The widget still hides fence
    // syntax; block styling is still applied via spec.className.
    //
    // captionPosition === "below" (figure, table): the header label goes on
    // the last body line instead of the opening fence. The opening fence gets
    // collapsed (no label) and the title text becomes the caption, displayed
    // on the opening line without the "Figure 1." prefix.
    const showHeader = plugin.displayHeader !== false && !captionBelow && !inlineHeader;
    const headerClass = cursorOnEitherFence
      ? spec.className
      : showHeader
        ? `${spec.className} ${CSS.blockHeader}`
        : `${spec.className} ${CSS.blockHeaderCollapsed}`;
    items.push(Decoration.line({ class: headerClass }).range(div.from));
    if (cursorOnEitherFence) {
      const syntaxEnd = div.titleFrom ?? div.openFenceTo;
      if (syntaxEnd > div.openFenceFrom) {
        items.push(blockSourceMark.range(div.openFenceFrom, syntaxEnd));
      }
    }
    if (captionBelow || inlineHeader) {
      // For below-caption blocks: hide fence prefix but show no label on opening line.
      // The rendered label is emitted elsewhere in the block.
      addHeaderWidgetDecoration(div, "", cursorOnEitherFence, macros, items);
    } else {
      addHeaderWidgetDecoration(div, spec.header, cursorOnEitherFence, macros, items);
    }

    // Title text: wrap in visual parentheses via widget decorations (rendered mode only).
    // Uses Decoration.widget (not Decoration.mark with CSS ::before/::after) because
    // marks get split around Decoration.replace (math widgets), causing ") $x^2$".
    // For below-caption blocks, title text is the caption — no parens needed.
    if (!cursorOnEitherFence && !captionBelow && !inlineHeader && div.titleFrom !== undefined && div.titleTo !== undefined) {
      items.push(openParenWidget.range(div.titleFrom));
      items.push(closeParenWidget.range(div.titleTo));
    }

    if (!cursorOnEitherFence && (captionBelow || inlineHeader) && div.titleFrom !== undefined && div.titleTo !== undefined) {
      items.push(decorationHidden.range(div.titleFrom, div.titleTo));
    }

    // Attribute-only title (not used for below-caption blocks — their title is the caption).
    if (
      !cursorOnEitherFence &&
      !captionBelow &&
      div.titleFrom === undefined &&
      div.titleTo === undefined &&
      div.title
    ) {
      items.push(
        Decoration.widget({
          widget: new AttributeTitleWidget(div.title, macros),
          side: 1,
        }).range(div.openFenceTo),
      );
    }

    // --- Closing fence ---
    // Always hidden in rich mode regardless of cursor position (#428).
    // The closing fence is protected from accidental deletion by a
    // transaction filter and skipped by atomicRanges (see below).
    if (div.singleLine) {
      addSingleLineClosingFence(state, div.closeFenceFrom, div.closeFenceTo, items);
    } else {
      hideMultiLineClosingFence(div.closeFenceFrom, div.closeFenceTo, items);

      // Embed blocks: replace body content with iframe widget
      if (isEmbed && !cursorOnEitherFence) {
        const openLine = state.doc.lineAt(div.openFenceFrom);
        addEmbedWidget(state, div, openLine, items);
      }
    }

    // Body lines: apply block-type class for per-type styling (italic, etc.)
    if (!div.singleLine) {
      const openLine = state.doc.lineAt(div.from);
      const closeFrom = div.closeFenceFrom >= 0 ? div.closeFenceFrom : div.to;
      const closeLine = state.doc.lineAt(closeFrom);
      for (let lineNum = openLine.number + 1; lineNum < closeLine.number; lineNum++) {
        const line = state.doc.line(lineNum);
        items.push(Decoration.line({ class: spec.className }).range(line.from));
      }

      if (inlineHeader && !cursorOnEitherFence && closeLine.number > openLine.number + 1) {
        const firstBodyLine = state.doc.line(openLine.number + 1);
        items.push(
          Decoration.line({ class: `${spec.className} ${CSS.blockHeader}` }).range(firstBodyLine.from),
        );
        items.push(
          Decoration.widget({
            widget: new BlockHeaderWidget(spec.header, macros),
            side: -1,
          }).range(firstBodyLine.from),
        );
      }

      // Below-caption label: add a real caption block after the content.
      if (captionBelow && !cursorOnEitherFence && closeLine.number > openLine.number + 1) {
        const lastBodyLine = state.doc.line(closeLine.number - 1);
        const captionWidget = new BlockCaptionWidget(spec.header, div.title ?? "", macros);
        captionWidget.sourceFrom = div.openFenceFrom;
        captionWidget.sourceTo = div.openFenceTo;
        items.push(
          Decoration.widget({
            widget: captionWidget,
            side: 1,
            block: true,
          }).range(lastBodyLine.to),
        );
      }
    }

    // QED tombstone for blocks with "qed" special behavior (closing fence is always hidden)
    if (plugin.specialBehavior === "qed") {
      addQedDecoration(state, div, items);
    }
  });

  return baseDecos;
}

/**
 * CM6 StateField that provides block rendering decorations.
 *
 * Uses a StateField so that line decorations (Decoration.line) and
 * mark decorations are permitted by CM6.
 */
const blockDecorationField = createFencedBlockDecorationField(buildBlockDecorations);

/** Exported for unit testing decoration logic without a browser. */
export { blockDecorationField as _blockDecorationFieldForTest };

/** CM6 extension that renders fenced divs using the block plugin system. */
export const blockRenderPlugin: Extension = [
  documentSemanticsField,
  editorFocusField,
  focusTracker,
  blockDecorationField,
  fenceProtectionExtension,
];
