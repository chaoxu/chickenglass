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
  EditorView,
} from "@codemirror/view";
import { type EditorState, type Extension, type Range, StateField } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { extractDivClass } from "../parser/fenced-div-attrs";
import type { BlockAttrs } from "./plugin-types";
import { pluginRegistryField, getPluginOrFallback } from "./plugin-registry";
import { blockCounterField, type BlockCounterState } from "./block-counter";
import {
  buildDecorations,
  decorationHidden,
  serializeMacros,
  editorFocusField,
  focusEffect,
  focusTracker,
  RenderWidget,
} from "../render/render-utils";
import { mathMacrosField } from "../render/math-macros";
import { MathWidget } from "../render/math-render";
import { renderInlineMarkdown } from "../render/inline-render";
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

interface FencedDivInfo {
  readonly from: number;
  readonly to: number;
  readonly fenceFrom: number;
  readonly fenceTo: number;
  readonly attrFrom?: number;
  readonly attrTo?: number;
  readonly titleFrom?: number;
  readonly titleTo?: number;
  readonly closeFenceFrom: number;
  readonly closeFenceTo: number;
  /** True when opening and closing fence are on the same line. */
  readonly singleLine: boolean;
  readonly className: string;
  readonly id?: string;
  readonly title?: string;
}

/** Extract info about FencedDiv nodes from the syntax tree. */
function collectFencedDivs(state: EditorState): FencedDivInfo[] {
  const results: FencedDivInfo[] = [];
  const tree = syntaxTree(state);

  tree.iterate({
    enter(node) {
      if (node.type.name !== "FencedDiv") return;

      const divNode = node.node;
      let className: string | undefined;
      let id: string | undefined;
      let title: string | undefined;
      let fenceFrom = node.from;
      let fenceTo = node.from;
      let attrFrom: number | undefined;
      let attrTo: number | undefined;
      let titleFrom: number | undefined;
      let titleTo: number | undefined;
      let closeFenceFrom = -1;
      let closeFenceTo = -1;

      // Collect all FencedDivFence children (opening + closing)
      const fences = divNode.getChildren("FencedDivFence");
      if (fences.length > 0) {
        fenceFrom = fences[0].from;
        fenceTo = fences[0].to;
      }
      let singleLine = false;
      if (fences.length > 1) {
        const lastFence = fences[fences.length - 1];
        const openLine = state.doc.lineAt(fenceFrom);
        const closeLine = state.doc.lineAt(lastFence.from);
        singleLine = openLine.number === closeLine.number;
        if (singleLine) {
          // Single-line: just the closing colons, not the full line
          closeFenceFrom = lastFence.from;
          closeFenceTo = lastFence.to;
        } else {
          // Multi-line: the full closing fence line
          closeFenceFrom = closeLine.from;
          closeFenceTo = closeLine.to;
        }
      }

      const attrNode = divNode.getChild("FencedDivAttributes");
      if (attrNode) {
        const attrText = state.doc.sliceString(attrNode.from, attrNode.to);
        const attrs = extractDivClass(attrText);
        if (attrs && attrs.classes.length > 0) {
          className = attrs.classes[0];
          id = attrs.id;
        }
        attrFrom = attrNode.from;
        attrTo = attrNode.to;
        fenceTo = Math.max(fenceTo, attrNode.to);
      }

      const titleNode = divNode.getChild("FencedDivTitle");
      if (titleNode) {
        title = state.doc.sliceString(titleNode.from, titleNode.to).trim();
        titleFrom = titleNode.from;
        titleTo = titleNode.to;
        fenceTo = Math.max(fenceTo, titleNode.to);
      }

      if (className) {
        results.push({
          from: node.from,
          to: node.to,
          fenceFrom,
          fenceTo,
          attrFrom,
          attrTo,
          titleFrom,
          titleTo,
          closeFenceFrom,
          closeFenceTo,
          singleLine,
          className,
          id,
          title,
        });
      }
    },
  });

  return results;
}


/** Hide all fence syntax for include blocks so content flows seamlessly. */
function addIncludeDecorations(
  div: FencedDivInfo,
  items: Range<Decoration>[],
): void {
  // Hide the entire opening fence line
  items.push(decorationHidden.range(div.fenceFrom, div.fenceTo));
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
    Decoration.line({ class: "cg-include-fence" }).range(div.fenceFrom),
  );
  if (div.closeFenceFrom >= 0) {
    items.push(
      Decoration.line({ class: "cg-include-fence" }).range(div.closeFenceFrom),
    );
  }
}

/**
 * Determine whether a fenced div should show its rendered form or raw source.
 *
 * Returns true when the block should be rendered (cursor is not on the fence).
 * Embed blocks require the cursor to be entirely outside the block; regular
 * blocks only check whether the cursor sits on the opening or closing fence.
 */
function shouldShowRendered(
  state: EditorState,
  div: FencedDivInfo,
  focused: boolean,
): boolean {
  const cursor = state.selection.main;
  const openLine = state.doc.lineAt(div.fenceFrom);
  const cursorOnOpenFence =
    focused && cursor.from >= openLine.from && cursor.from <= openLine.to;
  const cursorOnCloseFence =
    focused &&
    div.closeFenceFrom >= 0 &&
    cursor.from >= div.closeFenceFrom &&
    cursor.from <= div.closeFenceTo;
  const cursorOnFence = cursorOnOpenFence || cursorOnCloseFence;

  const isEmbed = EMBED_CLASSES.has(div.className);
  const cursorInsideBlock =
    focused && cursor.from >= div.from && cursor.from <= div.to;
  return isEmbed ? !cursorInsideBlock : !cursorOnFence;
}

/** Replace the opening fence+attrs with a rendered header widget. */
function addHeaderWidgetDecoration(
  div: FencedDivInfo,
  header: string,
  macros: Record<string, string>,
  macrosKey: string,
  items: Range<Decoration>[],
): void {
  const replaceEnd = div.titleFrom ?? div.fenceTo;
  const label = div.titleFrom !== undefined ? header + " " : header;
  items.push(
    Decoration.replace({
      widget: new BlockHeaderWidget(label, macros, macrosKey),
    }).range(div.fenceFrom, replaceEnd),
  );
}

/**
 * Hide the trailing closing fence colons on a single-line block.
 *
 * Also trims any whitespace immediately before the closing `:::`.
 */
function addSingleLineClosingFence(
  state: EditorState,
  div: FencedDivInfo,
  items: Range<Decoration>[],
): void {
  if (div.closeFenceFrom < 0) return;

  let hideFrom = div.closeFenceFrom;
  const lineText = state.doc.lineAt(div.closeFenceFrom).text;
  const lineStart = state.doc.lineAt(div.closeFenceFrom).from;
  const relPos = hideFrom - lineStart;
  // Walk back to trim trailing whitespace before :::
  let trimFrom = relPos;
  while (
    trimFrom > 0 &&
    (lineText.charCodeAt(trimFrom - 1) === 32 ||
      lineText.charCodeAt(trimFrom - 1) === 9)
  ) {
    trimFrom--;
  }
  hideFrom = lineStart + trimFrom;
  items.push(decorationHidden.range(hideFrom, div.closeFenceTo));
}

/** Hide closing fence text and collapse the line to zero height for multi-line blocks. */
function addMultiLineClosingFence(
  div: FencedDivInfo,
  items: Range<Decoration>[],
): void {
  if (div.closeFenceFrom < 0 || div.closeFenceTo < div.closeFenceFrom) return;

  items.push(decorationHidden.range(div.closeFenceFrom, div.closeFenceTo));
  items.push(
    Decoration.line({ class: "cg-include-fence" }).range(div.closeFenceFrom),
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

/** Render inline math ($...$) in title text (Typora-style: cursor inside shows source). */
function addTitleMathDecorations(
  state: EditorState,
  div: FencedDivInfo,
  focused: boolean,
  cursorFrom: number,
  macros: Record<string, string>,
  items: Range<Decoration>[],
): void {
  if (div.titleFrom === undefined || div.titleTo === undefined) return;

  const titleText = state.sliceDoc(div.titleFrom, div.titleTo);
  const regex = /\$([^$\n]+)\$/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(titleText)) !== null) {
    const mathFrom = div.titleFrom + match.index;
    const mathTo = mathFrom + match[0].length;
    if (focused && cursorFrom >= mathFrom && cursorFrom <= mathTo) continue;
    const widget = new MathWidget(match[1], match[0], false, macros);
    items.push(Decoration.replace({ widget }).range(mathFrom, mathTo));
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
    if (lastContentLine.from > div.fenceFrom) {
      items.push(
        Decoration.line({ class: "cg-block-qed" }).range(lastContentLine.from),
      );
    }
  }
}

/** Build decorations for all fenced divs using the plugin registry. */
function buildBlockDecorations(state: EditorState): DecorationSet {
  const registry = state.field(pluginRegistryField);
  const counterState: BlockCounterState | undefined =
    state.field(blockCounterField, false) ?? undefined;
  const focused = state.field(editorFocusField, false) ?? false;
  const divs = collectFencedDivs(state);
  const items: Range<Decoration>[] = [];

  const macros = state.field(mathMacrosField);
  const macrosKey = serializeMacros(macros);

  for (const div of divs) {
    const plugin = getPluginOrFallback(registry, div.className);

    // Include blocks are always invisible — content flows seamlessly
    if (div.className === "include") {
      addIncludeDecorations(div, items);
      continue;
    }

    const showRendered = shouldShowRendered(state, div, focused);
    const isEmbed = EMBED_CLASSES.has(div.className);

    if (showRendered && plugin) {
      const numberEntry = counterState?.byPosition.get(div.from);
      const labelAttrs: BlockAttrs = {
        type: div.className,
        id: div.id,
        number: numberEntry?.number,
      };
      const spec = plugin.render(labelAttrs);

      // Line decoration for block CSS class
      items.push(
        Decoration.line({
          class: `${spec.className} cg-block-header`,
        }).range(div.from),
      );

      // Header widget (shared for single-line and multi-line)
      addHeaderWidgetDecoration(div, spec.header, macros, macrosKey, items);

      if (div.singleLine) {
        addSingleLineClosingFence(state, div, items);
      } else {
        // Apply block class to body lines for type-specific styling
        const openLine = state.doc.lineAt(div.fenceFrom);
        const closeLine = state.doc.lineAt(div.closeFenceFrom);
        for (let ln = openLine.number + 1; ln < closeLine.number; ln++) {
          const line = state.doc.line(ln);
          items.push(
            Decoration.line({ class: spec.className }).range(line.from),
          );
        }

        addMultiLineClosingFence(div, items);

        // Embed blocks: replace body content with iframe widget
        if (isEmbed) {
          addEmbedWidget(state, div, openLine, items);
        }
      }

      // Render inline math in title text (rendered mode only)
      const cursor = state.selection.main;
      addTitleMathDecorations(state, div, focused, cursor.from, macros, items);

      // QED tombstone for proof blocks (rendered mode only)
      if (plugin.defaults?.qedSymbol) {
        addQedDecoration(state, div, items);
      }
    } else if (plugin) {
      // Cursor on fence (or inside embed block): show fence syntax as source
      items.push(
        Decoration.line({
          class: `${plugin.render({ type: div.className }).className} cg-block-source`,
        }).range(div.from),
      );
    }
  }

  return buildDecorations(items);
}

/**
 * CM6 StateField that provides block rendering decorations.
 *
 * Uses a StateField so that line decorations (Decoration.line) and
 * mark decorations are permitted by CM6.
 */
const blockDecorationField = StateField.define<DecorationSet>({
  create(state) {
    return buildBlockDecorations(state);
  },

  update(value, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      tr.effects.some((e) => e.is(focusEffect)) ||
      syntaxTree(tr.state) !== syntaxTree(tr.startState)
    ) {
      return buildBlockDecorations(tr.state);
    }
    return value;
  },

  provide(field) {
    return EditorView.decorations.from(field);
  },
});

/** CM6 extension that renders fenced divs using the block plugin system. */
export const blockRenderPlugin: Extension = [
  editorFocusField,
  focusTracker,
  blockDecorationField,
];
