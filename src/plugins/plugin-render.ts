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
import { Annotation, EditorState, type Extension, type Range, RangeSet } from "@codemirror/state";
import type { BlockAttrs } from "./plugin-types";
import { pluginRegistryField, getPluginOrFallback } from "./plugin-registry";
import { blockCounterField, type BlockCounterState } from "./block-counter";
import {
  createSimpleTextWidget,
  decorationHidden,
  editorFocusField,
  focusTracker,
  MacroAwareWidget,
  RenderWidget,
  addMarkerReplacement,
  pushWidgetDecoration,
  addSingleLineClosingFence,
  buildFencedBlockDecorations,
  createFencedBlockDecorationField,
  type FencedBlockInfo,
  mathMacrosField,
} from "../render/render-core";
import { renderDocumentFragmentToDom } from "../document-surfaces";
import {
  type FencedDivSemantics,
} from "../semantics/document";
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
    const el = document.createElement("span");
    el.className = CSS.blockHeaderRendered;
    renderDocumentFragmentToDom(el, {
      kind: "block-title",
      text: this.header,
      macros: this.macros,
    });
    return el;
  }

  eq(other: BlockHeaderWidget): boolean {
    return this.header === other.header && this.macrosKey === other.macrosKey;
  }
}

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

interface FencedDivInfo extends FencedBlockInfo, FencedDivSemantics {
  readonly className: string;
}

/** Extract info about FencedDiv nodes from the shared semantics field. */
function collectFencedDivs(state: EditorState): FencedDivInfo[] {
  return state.field(documentSemanticsField).fencedDivs
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
  const widget = new BlockHeaderWidget(header, macros);
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
    const showHeader = plugin.displayHeader !== false;
    const headerClass = cursorOnEitherFence
      ? spec.className
      : showHeader
        ? `${spec.className} ${CSS.blockHeader}`
        : `${spec.className} ${CSS.blockHeaderCollapsed}`;
    items.push(Decoration.line({ class: headerClass }).range(div.from));
    if (cursorOnEitherFence) {
      // Mark only the fence syntax portion as monospace source.
      // titleFrom marks where title text begins; if no title, openFenceTo
      // is the end of the fence prefix. Either way, everything before that
      // is syntax scaffolding.
      const syntaxEnd = div.titleFrom ?? div.openFenceTo;
      if (syntaxEnd > div.openFenceFrom) {
        items.push(blockSourceMark.range(div.openFenceFrom, syntaxEnd));
      }
    }
    addHeaderWidgetDecoration(div, spec.header, cursorOnEitherFence, macros, items);

    // Title text: wrap in visual parentheses via widget decorations (rendered mode only).
    // Uses Decoration.widget instead of Decoration.mark with CSS ::before/::after
    // because marks get split around Decoration.replace (math widgets), causing
    // ") $x^2$" instead of "$x^2$)".
    if (!cursorOnEitherFence && div.titleFrom !== undefined && div.titleTo !== undefined) {
      items.push(openParenWidget.range(div.titleFrom));
      items.push(closeParenWidget.range(div.titleTo));
    }

    // Attribute-only title: when titleFrom/titleTo are absent (no inline title text)
    // but div.title is set from key-value attributes (e.g. title="**3SUM**"),
    // render the title via a widget placed after the header widget. The title
    // isn't editable document content, so a widget is architecturally correct.
    // Inline titles (titleFrom/titleTo defined) take precedence — the attribute
    // title is only used when there's no inline text.
    if (
      !cursorOnEitherFence &&
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
    } else if (div.closeFenceFrom >= 0 && div.closeFenceTo >= div.closeFenceFrom) {
      items.push(decorationHidden.range(div.closeFenceFrom, div.closeFenceTo));
      items.push(
        Decoration.line({ class: CSS.blockClosingFence }).range(div.closeFenceFrom),
      );

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
export {
  openingFenceDeletionCleanup as _openingFenceDeletionCleanupForTest,
  closingFenceProtection as _closingFenceProtectionForTest,
  openingFenceColonProtection as _openingFenceColonProtectionForTest,
};

// ---------------------------------------------------------------------------
// Fence protection
// ---------------------------------------------------------------------------

/** Annotation to bypass fence protection filters (used by block-type picker). */
export const fenceOperationAnnotation = Annotation.define<true>();

/**
 * Return fenced divs that should have their fences protected.
 * Filters out single-line divs, excluded classes (include), and
 * unregistered block types. Shared by all fence range collectors
 * to avoid repeated collectFencedDivs + filtering per transaction.
 */
function getProtectedDivs(state: EditorState): FencedDivInfo[] {
  const divs = collectFencedDivs(state);
  const registry = state.field(pluginRegistryField, false);
  return divs.filter((div) => {
    if (div.singleLine) return false;
    if (EXCLUDED_FROM_FALLBACK.has(div.className)) return false;
    if (registry && !getPluginOrFallback(registry, div.className)) return false;
    return true;
  });
}

/** Collect closing fence line ranges for protection. */
function getClosingFenceRanges(state: EditorState): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  const seen = new Set<number>();
  for (const div of getProtectedDivs(state)) {
    if (div.closeFenceFrom < 0) continue;
    const line = state.doc.lineAt(div.closeFenceFrom);
    if (!seen.has(line.from)) {
      seen.add(line.from);
      ranges.push({ from: line.from, to: line.to });
    }
  }
  return ranges;
}

/**
 * Transaction filter that auto-removes the closing fence when an opening fence
 * line is fully deleted. Without this, deleting a block's header leaves an
 * orphaned closing `:::` in the document.
 *
 * Uses collectFencedDivs directly (not getProtectedDivs) because cleanup
 * should apply to ALL fenced divs, including unregistered/custom types.
 * Protection filters are narrower — they only guard registered blocks.
 *
 * The returned spec carries fenceOperationAnnotation so both protection
 * filters are bypassed for the combined structural deletion.
 */
const openingFenceDeletionCleanup = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  if (tr.annotation(fenceOperationAnnotation)) return tr;

  const state = tr.startState;
  const divs = collectFencedDivs(state);
  if (divs.length === 0) return tr;

  const closingFencesToRemove: { from: number; to: number }[] = [];

  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (inserted.length > 1) return;

    for (const div of divs) {
      if (div.singleLine || div.closeFenceFrom < 0) continue;

      const openLine = state.doc.lineAt(div.openFenceFrom);

      if (fromA <= openLine.from && toA >= openLine.to) {
        if (fromA <= div.closeFenceFrom && toA >= div.closeFenceTo) continue;

        // Include the preceding newline so the line is fully removed
        const closeLine = state.doc.lineAt(div.closeFenceFrom);
        const removeFrom = closeLine.from > 0 ? closeLine.from - 1 : closeLine.from;
        const removeTo = closeLine.to < state.doc.length ? closeLine.to + 1 : closeLine.to;
        closingFencesToRemove.push({ from: removeFrom, to: removeTo });
      }
    }
  });

  if (closingFencesToRemove.length === 0) return tr;

  const changes: { from: number; to: number; insert: string }[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    changes.push({ from: fromA, to: toA, insert: inserted.toString() });
  });
  for (const c of closingFencesToRemove) {
    changes.push({ from: c.from, to: c.to, insert: "" });
  }
  // CM6 requires changes sorted by position and non-overlapping
  changes.sort((a, b) => a.from - b.from);

  return {
    changes,
    annotations: fenceOperationAnnotation.of(true),
  };
});

/**
 * Transaction filter that protects closing fence lines from accidental deletion.
 *
 * Blocks any edit that touches only the closing fence line content. Whole-block
 * deletion (selection covering the entire fenced div) is still allowed so that
 * Cmd+A + Delete works.
 */
const closingFenceProtection = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  // Bypass for programmatic fence operations (block-type picker, etc.)
  if (tr.annotation(fenceOperationAnnotation)) return tr;

  const fenceRanges = getClosingFenceRanges(tr.startState);
  if (fenceRanges.length === 0) return tr;

  const docLen = tr.startState.doc.length;
  let blocked = false;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (blocked) return;
    for (const fence of fenceRanges) {
      if (fromA <= fence.to && toA >= fence.from) {
        // Account for document boundaries: start-of-doc counts as "before",
        // end-of-doc counts as "after".
        const extendsBeforeFence = fromA < fence.from - 1 || fromA === 0;
        const extendsAfterFence = toA > fence.to + 1 || toA >= docLen;
        if (extendsBeforeFence && extendsAfterFence) continue;
        // Allow if it's a replacement that includes the fence (structural edit)
        if (inserted.length > 0 && extendsBeforeFence) continue;
        // Block: the edit targets only the closing fence
        blocked = true;
        return;
      }
    }
  });

  return blocked ? [] : tr;
});

/** Collect opening fence colon-prefix ranges for protection. */
function getOpeningFenceColonRanges(state: EditorState): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  const seen = new Set<number>();
  for (const div of getProtectedDivs(state)) {
    if (seen.has(div.openFenceFrom)) continue;
    seen.add(div.openFenceFrom);
    const text = state.sliceDoc(div.openFenceFrom, div.openFenceTo);
    let colonLen = 0;
    while (colonLen < text.length && text[colonLen] === ":") colonLen++;
    if (colonLen >= 3) {
      ranges.push({ from: div.openFenceFrom, to: div.openFenceFrom + colonLen });
    }
  }
  return ranges;
}

/**
 * Transaction filter that protects opening fence colon prefixes from accidental edits.
 *
 * In rich mode, users interact with the widget label, not the raw colons.
 * Edits that touch only the colon prefix (:::) are blocked to prevent
 * nesting invariant violations. Edits to attributes ({.theorem}) and
 * title text are unaffected. Whole-block deletion is still allowed.
 */
const openingFenceColonProtection = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  if (tr.annotation(fenceOperationAnnotation)) return tr;

  const colonRanges = getOpeningFenceColonRanges(tr.startState);
  if (colonRanges.length === 0) return tr;

  let blocked = false;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (blocked) return;
    for (const colon of colonRanges) {
      if (fromA <= colon.to && toA >= colon.from) {
        if (fromA === toA) continue; // pure insertion
        if (fromA >= colon.to) continue; // editing attrs/title after colons
        // Whole-block deletion: spans past colons on both sides
        const atOrBeforeStart = fromA <= colon.from;
        const pastColonEnd = toA > colon.to;
        if (atOrBeforeStart && pastColonEnd) continue;
        if (inserted.length > 0 && fromA < colon.from) continue; // structural replacement
        blocked = true;
        return;
      }
    }
  });

  return blocked ? [] : tr;
});

/**
 * Atomic ranges for closing fence lines so the cursor skips over them.
 *
 * Uses EditorView.atomicRanges to make the hidden closing fence behave as
 * a single atomic unit — the cursor jumps from the last content line to
 * the start of the next block or paragraph without stopping on the fence.
 */
const closingFenceAtomicRanges = EditorView.atomicRanges.of((view) => {
  const ranges: Range<Decoration>[] = [];
  const fenceRanges = getClosingFenceRanges(view.state);
  const mark = Decoration.mark({});
  for (const fence of fenceRanges) {
    // Include the newline before the fence to make cursor skip the whole line
    const atomicFrom = fence.from > 0 ? fence.from - 1 : fence.from;
    const atomicTo = fence.to < view.state.doc.length ? fence.to + 1 : fence.to;
    ranges.push(mark.range(atomicFrom, atomicTo));
  }
  return RangeSet.of(ranges, true);
});

/** CM6 extension that renders fenced divs using the block plugin system. */
export const blockRenderPlugin: Extension = [
  documentSemanticsField,
  editorFocusField,
  focusTracker,
  blockDecorationField,
  // CM6 runs transactionFilters in reverse registration order, so cleanup
  // (registered first) executes AFTER protections have already passed/blocked.
  openingFenceDeletionCleanup,
  closingFenceProtection,
  openingFenceColonProtection,
  closingFenceAtomicRanges,
];
