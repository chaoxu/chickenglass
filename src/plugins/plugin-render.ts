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
    el.className = "cg-block-header-rendered";
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
    wrapper.className = `cg-embed cg-embed-${this.embedType}`;

    const iframe = document.createElement("iframe");
    iframe.src = this.src;
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
    iframe.setAttribute("loading", "lazy");
    iframe.setAttribute("referrerpolicy", "no-referrer");
    iframe.setAttribute("frameborder", "0");

    if (this.embedType === "youtube") {
      iframe.setAttribute("allowfullscreen", "");
      iframe.className = "cg-embed-iframe cg-embed-youtube-iframe";
    } else {
      iframe.className = "cg-embed-iframe";
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
    Decoration.line({ class: "cg-include-fence" }).range(div.openFenceFrom),
  );
  if (div.closeFenceFrom >= 0) {
    items.push(
      Decoration.line({ class: "cg-include-fence" }).range(div.closeFenceFrom),
    );
  }
}

/** Replace the opening fence+attrs with a rendered header widget. */
function addHeaderWidgetDecoration(
  div: FencedDivInfo,
  header: string,
  macros: Record<string, string>,
  macrosKey: string,
  items: Range<Decoration>[],
): void {
  const replaceEnd = div.titleTo ?? div.openFenceTo;
  const widget = new BlockHeaderWidget(header, macros, macrosKey);
  widget.sourceFrom = div.openFenceFrom;
  items.push(
    Decoration.replace({ widget }).range(div.openFenceFrom, replaceEnd),
  );
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
        Decoration.line({ class: "cg-block-qed" }).range(lastContentLine.from),
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
            class: `${plugin.render({ type: div.className }).className} cg-block-source`,
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
    if (cursorOnEitherFence) {
      // Source mode: show raw ::: {.class} Title with block styling
      // Inline math in the title still renders (Typora-style toggle)
      items.push(
        Decoration.line({
          class: `${spec.className} cg-block-source`,
        }).range(div.from),
      );
    } else {
      // Rendered mode: header widget replaces fence syntax
      items.push(
        Decoration.line({
          class: `${spec.className} cg-block-header`,
        }).range(div.from),
      );
      addHeaderWidgetDecoration(div, spec.header, macros, macrosKey, items);
    }

    // --- Closing fence ---
    if (cursorOnEitherFence) {
      // Source mode: show raw ::: with block styling
      if (!div.singleLine && div.closeFenceFrom >= 0) {
        items.push(
          Decoration.line({
            class: `${spec.className} cg-block-source`,
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
