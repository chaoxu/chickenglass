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
import { type EditorState, type Extension, type Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { BlockAttrs } from "./plugin-types";
import { pluginRegistryField, getPluginOrFallback } from "./plugin-registry";
import { blockCounterField, type BlockCounterState } from "./block-counter";
import {
  decorationHidden,
  serializeMacros,
  editorFocusField,
  focusTracker,
  RenderWidget,
  addMarkerReplacement,
} from "../render/render-utils";
import {
  addCollapsedClosingFence,
  addSingleLineClosingFence,
  buildFencedBlockDecorations,
  createFencedBlockDecorationField,
  type FencedBlockInfo,
} from "../render/fenced-block-core";
import { mathMacrosField } from "../render/math-macros";
import { renderInlineMarkdown } from "../render/inline-render";
import {
  analyzeFencedDivs,
  type FencedDivSemantics,
} from "../semantics/document";
import { editorStateTextSource } from "../semantics/codemirror-source";
import {
  isValidEmbedUrl,
  extractYoutubeId,
  youtubeEmbedUrl,
  gistEmbedUrl,
} from "./embed-plugin";

/** Widget that renders a block header string with inline math/bold/italic. */
class BlockHeaderWidget extends RenderWidget {
  constructor(
    private readonly header: string,
    private readonly macros: Record<string, string>,
    private readonly macrosKey: string,
  ) {
    super();
  }

  createDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cf-block-header-rendered";
    renderInlineMarkdown(el, this.header, this.macros);
    return el;
  }

  eq(other: BlockHeaderWidget): boolean {
    return this.header === other.header && this.macrosKey === other.macrosKey;
  }
}

/** Set of fenced div class names that are embed types. */
const EMBED_CLASSES = new Set(["embed", "iframe", "youtube", "gist"]);

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
  const maxAttempts = 10;
  const pollInterval = 500;

  const poll = (): void => {
    attempts++;
    const r = tryResizeIframe(iframe);
    if (r === "unavailable" && attempts < maxAttempts) {
      setTimeout(poll, pollInterval);
    }
  };

  setTimeout(poll, pollInterval);
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
    wrapper.className = `cf-embed cf-embed-${this.embedType}`;

    const iframe = document.createElement("iframe");
    iframe.src = this.src;
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
    iframe.setAttribute("loading", "lazy");
    iframe.setAttribute("referrerpolicy", "no-referrer");
    iframe.setAttribute("frameborder", "0");

    if (this.embedType === "youtube") {
      iframe.setAttribute("allowfullscreen", "");
      iframe.className = "cf-embed-iframe cf-embed-youtube-iframe";
    } else {
      iframe.className = "cf-embed-iframe";
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

interface FencedDivInfo extends FencedBlockInfo, FencedDivSemantics {
  readonly className: string;
}

/** Extract info about FencedDiv nodes from the syntax tree. */
function collectFencedDivs(state: EditorState): FencedDivInfo[] {
  return analyzeFencedDivs(editorStateTextSource(state), syntaxTree(state))
    .filter((div): div is FencedDivSemantics & { primaryClass: string } => Boolean(div.primaryClass))
    .map((div) => ({
      ...div,
      className: div.primaryClass,
    }));
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
  if (div.closeFenceFrom >= 0 && div.closeFenceTo >= div.closeFenceFrom) {
    items.push(decorationHidden.range(div.closeFenceFrom, div.closeFenceTo));
  }
  // Collapse fence lines to zero height
  items.push(
    Decoration.line({ class: "cf-include-fence" }).range(div.openFenceFrom),
  );
  if (div.closeFenceFrom >= 0) {
    items.push(
      Decoration.line({ class: "cf-include-fence" }).range(div.closeFenceFrom),
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
  macrosKey: string,
  items: Range<Decoration>[],
): void {
  // Replace only the fence prefix, leave title text as editable content.
  // No-title case: replaceEnd = openFenceTo (whole fence line, nothing to split).
  // With-title case: replaceEnd = titleFrom (stop before title text).
  const replaceEnd = div.titleFrom ?? div.openFenceTo;
  const widget = new BlockHeaderWidget(header, macros, macrosKey);
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
    const widget = new EmbedWidget(src, div.className);
    widget.sourceFrom = bodyFrom;
    items.push(Decoration.replace({ widget }).range(bodyFrom, bodyTo));
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
        Decoration.line({ class: "cf-block-qed" }).range(lastContentLine.from),
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
  const macrosKey = serializeMacros(macros);
  const cursor = state.selection.main;
  return buildFencedBlockDecorations(state, collectFencedDivs, ({
    state,
    block: div,
    focused,
    cursorOnEitherFence,
  }, items) => {
    const plugin = getPluginOrFallback(registry, div.className);

    // Include blocks are always invisible — content flows seamlessly
    if (div.className === "include") {
      addIncludeDecorations(div, items);
      return;
    }

    if (!plugin) return;

    const isEmbed = EMBED_CLASSES.has(div.className);

    // Embed blocks: cursor inside → full source mode (all fences visible)
    if (isEmbed) {
      const cursorInsideBlock =
        focused && cursor.from >= div.from && cursor.from <= div.to;
      if (cursorInsideBlock) {
        items.push(
          Decoration.line({
            class: `${plugin.render({ type: div.className }).className} cf-block-source`,
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

    // --- Opening fence ---
    // Heading-like pattern: ALWAYS apply block styling, toggle marker visibility.
    // The widget replaces only the fence prefix (::: {.class}), NOT the title text.
    // Title text stays as editable content — inline plugins render math/bold/etc.
    // See CLAUDE.md "Block headers must behave like headings."
    const headerClass = cursorOnEitherFence
      ? `${spec.className} cf-block-source`
      : `${spec.className} cf-block-header`;
    items.push(Decoration.line({ class: headerClass }).range(div.from));
    addHeaderWidgetDecoration(div, spec.header, cursorOnEitherFence, macros, macrosKey, items);

    // Title text: wrap in visual parentheses via CSS mark (rendered mode only).
    // Source mode shows the raw title without parens.
    if (!cursorOnEitherFence && div.titleFrom !== undefined && div.titleTo !== undefined) {
      items.push(
        Decoration.mark({ class: "cf-block-title" }).range(div.titleFrom, div.titleTo),
      );
    }

    // --- Closing fence ---
    if (cursorOnEitherFence) {
      // Source mode: show raw ::: with block styling
      if (!div.singleLine && div.closeFenceFrom >= 0) {
        items.push(
          Decoration.line({
            class: `${spec.className} cf-block-source`,
          }).range(div.closeFenceFrom),
        );
      }
    } else {
      // Rendered mode: hide the closing fence
      if (div.singleLine) {
        addSingleLineClosingFence(state, div.closeFenceFrom, div.closeFenceTo, items);
      } else {
        addCollapsedClosingFence(div.closeFenceFrom, div.closeFenceTo, items);

        // Embed blocks: replace body content with iframe widget
        if (isEmbed) {
          const openLine = state.doc.lineAt(div.openFenceFrom);
          addEmbedWidget(state, div, openLine, items);
        }
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
    }

    // QED tombstone for proof blocks (only when closing fence is hidden)
    if (plugin.defaults?.qedSymbol && !cursorOnEitherFence) {
      addQedDecoration(state, div, items);
    }
  });
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
  editorFocusField,
  focusTracker,
  blockDecorationField,
];
