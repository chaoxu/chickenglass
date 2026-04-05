import {
  Decoration,
  type DecorationSet,
  EditorView,
  type PluginSpec,
  type PluginValue,
  type ViewUpdate,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import {
  type ChangeSet,
  type EditorState,
  type Extension,
  type Range,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type StateEffectType,
  type Transaction,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNodeRef } from "@lezer/common";

/**
 * Check whether the primary cursor is contained within [from, to].
 *
 * Accepts either an EditorView or EditorState:
 * - EditorView: also checks view.hasFocus (returns false when unfocused)
 * - EditorState: pure position check with no focus guard
 *
 * Uses containment (cursor.from >= from && cursor.to <= to) rather than
 * overlap so that clicking *near* a widget places the cursor outside the
 * replaced range and keeps the widget rendered.
 */
export function cursorInRange(
  viewOrState: EditorView | EditorState,
  from: number,
  to: number,
): boolean {
  if ("state" in viewOrState) {
    // EditorView path — guard on focus
    if (!viewOrState.hasFocus) return false;
    const cursor = viewOrState.state.selection.main;
    return cursor.from >= from && cursor.to <= to;
  }
  // EditorState path — no focus guard
  const cursor = viewOrState.selection.main;
  return cursor.from >= from && cursor.to <= to;
}

/** Result of collecting renderable nodes from the syntax tree. */
export interface RenderableNode {
  readonly type: string;
  readonly from: number;
  readonly to: number;
}

/**
 * Walk the syntax tree and collect nodes matching the given type names.
 * Accepts either an EditorView or EditorState.
 */
export function collectNodes(
  viewOrState: EditorView | EditorState,
  types: ReadonlySet<string>,
): RenderableNode[] {
  const state = "state" in viewOrState ? viewOrState.state : viewOrState;
  const results: RenderableNode[] = [];
  const c = syntaxTree(state).cursor();
  do {
    if (types.has(c.name)) {
      results.push({ type: c.name, from: c.from, to: c.to });
    }
  } while (c.next());
  return results;
}

/**
 * Serialize macros to a stable string for use in widget equality checks.
 * Returns an empty string when there are no macros.
 *
 * Results are cached per macro object identity via WeakMap so that
 * repeated calls within the same update cycle (widgets, change-detection)
 * pay the sort+join cost only once.
 */
const macroKeyCache = new WeakMap<Record<string, string>, string>();

export function serializeMacros(macros: Record<string, string>): string {
  const cached = macroKeyCache.get(macros);
  if (cached !== undefined) return cached;

  const keys = Object.keys(macros);
  if (keys.length === 0) {
    macroKeyCache.set(macros, "");
    return "";
  }
  keys.sort();
  const result = keys.map((k) => `${k}=${macros[k]}`).join("\0");
  macroKeyCache.set(macros, result);
  return result;
}

/**
 * Maps live widget DOM elements to their owning RenderWidget instance.
 *
 * Search-highlight reads `sourceFrom`/`sourceTo` from the widget instance
 * via this map rather than from DOM `data-source-from`/`data-source-to`
 * attributes, which can become stale when CM6 maps decoration positions
 * without calling `toDOM()` again.
 */
export const widgetSourceMap = new WeakMap<HTMLElement, RenderWidget>();

/** Shared Decoration.mark that visually hides source markers via CSS while keeping them in the DOM. */
export const decorationHidden = Decoration.mark({ class: "cf-hidden" });

/**
 * Heading-like marker replacement pattern.
 *
 * Both ATX headings and fenced div block headers follow the same principle:
 *
 *   1. A syntactic marker (# or ::: {.class}) is hidden/replaced when cursor is outside.
 *   2. Content text AFTER the marker stays as normal editable document content.
 *   3. Inline render plugins (math, bold, italic) handle the content naturally.
 *   4. When cursor enters the marker area, the marker becomes source.
 *
 * THIS IS CRITICAL — DO NOT "simplify" by replacing the full line with a single widget.
 * Doing so kills inline rendering of content text (e.g., $x^2$ won't render as KaTeX
 * in source mode). This has regressed 3+ times. See CLAUDE.md "Block headers must
 * behave like headings."
 *
 * @param markerFrom  Start of syntactic marker (# position, or ::: position)
 * @param markerTo    End of marker (before content text, e.g., titleFrom or openFenceTo)
 * @param cursorInside  True when cursor is in the marker's "source zone" (marker stays visible)
 * @param widget      Widget to show when marker is hidden. Null = hide without replacement (headings).
 *                    Widget must extend RenderWidget (sourceFrom will be set automatically).
 * @param items       Decoration range accumulator
 */
export function addMarkerReplacement(
  markerFrom: number,
  markerTo: number,
  cursorInside: boolean,
  widget: RenderWidget | null,
  items: Range<Decoration>[],
): void {
  if (cursorInside) return; // marker visible as source — nothing to replace
  if (markerFrom >= markerTo) return; // degenerate range

  if (widget) {
    widget.sourceFrom = markerFrom;
    widget.sourceTo = markerTo;
    items.push(Decoration.replace({ widget }).range(markerFrom, markerTo));
  } else {
    items.push(decorationHidden.range(markerFrom, markerTo));
  }
}

/** Check whether an array of ranges is already sorted by (from, to). */
function isSorted(items: ReadonlyArray<Range<Decoration>>): boolean {
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const curr = items[i];
    if (
      prev.from > curr.from ||
      (prev.from === curr.from && (
        prev.value.startSide > curr.value.startSide ||
        (prev.value.startSide === curr.value.startSide && prev.to > curr.to)
      ))
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Build a DecorationSet from an array of decoration ranges.
 * Sorts by position before building (RangeSetBuilder requires sorted input).
 * Skips the sort when items are already in order.
 */
export function buildDecorations(
  items: ReadonlyArray<Range<Decoration>>,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const ordered = isSorted(items)
    ? items
    : [...items].sort(
        (a, b) => a.from - b.from ||
          a.value.startSide - b.value.startSide ||
          a.to - b.to,
      );
  for (const item of ordered) {
    builder.add(item.from, item.to, item.value);
  }
  return builder.finish();
}

/**
 * Base class for render widgets.
 *
 * Subclasses implement `createDOM()` to build the widget element.
 * `toDOM(view)` attaches a mousedown handler that moves the cursor
 * inside the replaced range when clicked — necessary because CM6
 * places cursor at the boundary of Decoration.replace, not inside.
 *
 * Set `sourceFrom` before the widget is added to a decoration.
 */
export abstract class RenderWidget extends WidgetType {
  /** Document offset of the start of the source range this widget replaces. */
  sourceFrom = -1;

  /** Document offset of the end of the source range this widget replaces. */
  sourceTo = -1;

  /** Pristine DOM snapshot used to avoid rebuilding expensive widgets on scroll. */
  private cachedDOM: HTMLElement | null = null;

  /**
   * Subclasses build their DOM element here.
   *
   * Called by the default `toDOM()` implementation. Widgets that override
   * `toDOM()` entirely (e.g. widgets needing the view parameter for custom
   * event handling) do not need to implement this method.
   */
  createDOM(): HTMLElement {
    return document.createElement("span");
  }

  /**
   * Build the widget DOM once, then clone that pristine snapshot on later calls.
   *
   * Use this only for widgets whose structure is fully determined by their
   * constructor state. Event listeners that depend on the live EditorView should
   * still be attached in `toDOM()` after the clone is returned.
   */
  protected createCachedDOM(build: () => HTMLElement): HTMLElement {
    if (this.cachedDOM) {
      return cloneRenderedHTMLElement(this.cachedDOM);
    }

    const el = build();
    this.cachedDOM = cloneRenderedHTMLElement(el);
    return el;
  }

  protected setSourceRangeAttrs(el: HTMLElement): void {
    if (this.sourceFrom >= 0) {
      el.dataset.sourceFrom = String(this.sourceFrom);
    }
    if (this.sourceTo >= 0) {
      el.dataset.sourceTo = String(this.sourceTo);
    }
    widgetSourceMap.set(el, this);
  }

  /**
   * Update the source range after a position-mapping operation.
   *
   * When a decoration set is mapped through document changes instead of
   * rebuilt, the widget instances are reused at shifted positions.  This
   * method patches `sourceFrom`/`sourceTo` so that click-to-edit handlers
   * (which read these fields at event time) and search-highlight (which
   * reads them via {@link widgetSourceMap}) remain correct.
   */
  updateSourceRange(from: number, to: number): void {
    this.sourceFrom = from;
    this.sourceTo = to;
  }

  protected bindSourceReveal(
    el: HTMLElement,
    view: EditorView,
  ): void {
    el.style.cursor = "pointer";
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      // Focus first so the focus state field is updated before
      // the selection dispatch triggers decoration rebuilding.
      view.focus();
      // Derive position from CM6's live DOM tracking (always correct
      // after decoration mapping or rebuild) rather than the widget's
      // sourceFrom field, which can become stale when CM6 reuses
      // widget DOM across decoration rebuilds without calling toDOM().
      let pos: number;
      try {
        pos = view.posAtDOM(el);
      } catch {
        pos = this.sourceFrom;
      }
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: false });
    });
  }

  toDOM(view?: EditorView): HTMLElement {
    const el = this.createDOM();
    // Store source range as data attributes for search-highlight plugin
    this.setSourceRangeAttrs(el);
    if (this.sourceFrom >= 0 && view) {
      this.bindSourceReveal(el, view);
    }
    return el;
  }

  /**
   * Return true so CM6 does NOT also process mouse events on this widget.
   * Our mousedown handler in toDOM() handles cursor placement exclusively.
   * If CM6 also processes the event, it places cursor at the widget boundary
   * (outside the replaced range), overriding our handler.
   */
  ignoreEvent(): boolean {
    return true;
  }
}

function collectCanvasNodes(root: HTMLElement): HTMLCanvasElement[] {
  const canvases = [...root.querySelectorAll("canvas")];
  return root instanceof HTMLCanvasElement ? [root, ...canvases] : canvases;
}

function copyCanvasBitmap(
  source: HTMLCanvasElement,
  target: HTMLCanvasElement,
): void {
  target.width = source.width;
  target.height = source.height;

  const ctx = target.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(source, 0, 0);
}

/**
 * Deep-clone rendered DOM, preserving canvas bitmap contents.
 *
 * `cloneNode(true)` copies element structure but not canvas pixels, so widgets
 * that embed canvases need an explicit bitmap copy on the cloned nodes.
 */
export function cloneRenderedHTMLElement<T extends HTMLElement>(source: T): T {
  const clone = source.cloneNode(true) as T;
  const sourceCanvases = collectCanvasNodes(source);
  if (sourceCanvases.length === 0) {
    return clone;
  }

  const cloneCanvases = collectCanvasNodes(clone);
  const count = Math.min(sourceCanvases.length, cloneCanvases.length);
  for (let i = 0; i < count; i++) {
    copyCanvasBitmap(sourceCanvases[i], cloneCanvases[i]);
  }
  return clone;
}

/** StateEffect dispatched when the editor gains or loses focus. */
export const focusEffect = StateEffect.define<boolean>();

/**
 * Build a boolean StateField controlled solely by a matching StateEffect.
 *
 * The field preserves its previous value unless the transaction contains the
 * given effect, in which case it adopts the effect's boolean payload.
 */
export function createBooleanToggleField(
  effect: StateEffectType<boolean>,
  initialValue = false,
): StateField<boolean> {
  return StateField.define<boolean>({
    create() {
      return initialValue;
    },
    update(value, tr) {
      for (const candidate of tr.effects) {
        if (candidate.is(effect)) return candidate.value;
      }
      return value;
    },
  });
}

/**
 * Shared StateField that tracks whether the editor is focused.
 *
 * Used by StateField-based renderers (math, block plugins) that need
 * to know focus state to decide whether to show source or rendered view.
 */
export const editorFocusField = createBooleanToggleField(focusEffect);

/**
 * Extension that dispatches focus-change effects when the editor
 * gains or loses focus.
 *
 * Uses CM6's built-in {@link EditorView.focusChangeEffect} facet, which
 * defers the dispatch via setTimeout(10ms). The previous domEventHandlers
 * approach dispatched synchronously during the focus event — this caused
 * decoration rebuilds between mousedown and CM6's initial selection
 * computation, shifting the DOM so that `start.pos !== cur.pos` and
 * producing an unwanted range selection on the first click after scroll
 * (#755).
 */
export const focusTracker: Extension = EditorView.focusChangeEffect.of(
  (_state, focusing) => focusEffect.of(focusing),
);

/**
 * Push a widget replacement decoration, setting source range for click-to-edit.
 *
 * Common pattern: create a RenderWidget, set its sourceFrom/sourceTo, and push
 * a Decoration.replace into an accumulator array. Consolidates the 3-step
 * boilerplate into a single call.
 */
export function pushWidgetDecoration(
  items: Range<Decoration>[],
  widget: RenderWidget,
  from: number,
  to: number,
): void {
  widget.sourceFrom = from;
  widget.sourceTo = to;
  items.push(Decoration.replace({ widget }).range(from, to));
}

/**
 * Default update predicate for render ViewPlugins.
 *
 * Returns true only for structural changes: docChanged or syntaxTree changed.
 * Plugins that need cursor-sensitivity should use `cursorSensitiveShouldUpdate`
 * or provide a custom predicate that checks whether the active node changed.
 * Plugins that need viewport-triggered rebuilds (e.g., those iterating
 * visibleRanges) should opt in via `cursorSensitiveShouldUpdate` or a
 * per-plugin predicate that checks `update.viewportChanged`.
 *
 * Previously this also included selectionSet, focusChanged, and
 * viewportChanged — but those caused multiplicative cursor-move and scroll
 * cost across the rendering stack (#443, #577).
 */
export function defaultShouldUpdate(update: ViewUpdate): boolean {
  return (
    update.docChanged ||
    syntaxTree(update.state) !== syntaxTree(update.startState)
  );
}

/**
 * Cursor-sensitive update predicate for render ViewPlugins.
 *
 * Returns true for structural changes (doc/tree), plus selection and focus
 * changes. Use this for plugins that show/hide source based on cursor
 * proximity (e.g., markdown-render, checkbox-render, image-render).
 *
 * Includes viewportChanged because plugins that iterate visibleRanges
 * must rebuild when the viewport changes — otherwise content scrolled
 * into view stays as raw markdown (#437).
 *
 * NOTE: Plugins that want *incremental* viewport updates should use
 * `createCursorSensitiveViewPlugin` instead of `createSimpleViewPlugin`
 * with this predicate.  The new factory handles differential viewport
 * diffing internally (#578, split from #443).
 */
export function cursorSensitiveShouldUpdate(update: ViewUpdate): boolean {
  return (
    update.docChanged ||
    update.selectionSet ||
    update.focusChanged ||
    update.viewportChanged ||
    syntaxTree(update.state) !== syntaxTree(update.startState)
  );
}

// ── Differential viewport update (#578) ──────────────────────────────────────

/** A snapshot of a visible document range (matches CM6 visibleRanges shape). */
export interface VisibleRange {
  readonly from: number;
  readonly to: number;
}

/**
 * Compute the fragments of `newRanges` not covered by `oldRanges`.
 *
 * Both inputs must be sorted by `from` and non-overlapping (CM6's
 * `view.visibleRanges` satisfies both conditions).
 *
 * Returns ranges in document order.  Empty when `newRanges` ⊆ `oldRanges`.
 */
export function diffVisibleRanges(
  oldRanges: readonly VisibleRange[],
  newRanges: readonly VisibleRange[],
): VisibleRange[] {
  const result: VisibleRange[] = [];
  let oi = 0;

  for (const nr of newRanges) {
    let cursor = nr.from;

    // Advance old-range pointer past ranges entirely before `cursor`.
    while (oi < oldRanges.length && oldRanges[oi].to <= cursor) oi++;

    // Subtract each overlapping old range from [cursor, nr.to].
    for (let j = oi; j < oldRanges.length && oldRanges[j].from < nr.to; j++) {
      const or_ = oldRanges[j];
      if (or_.from > cursor) {
        result.push({ from: cursor, to: or_.from });
      }
      cursor = Math.max(cursor, or_.to);
      if (cursor >= nr.to) break;
    }

    if (cursor < nr.to) {
      result.push({ from: cursor, to: nr.to });
    }
  }

  return result;
}

/** Check whether a document position falls inside any of the given sorted ranges. */
export function isPositionInRanges(
  pos: number,
  ranges: readonly VisibleRange[],
): boolean {
  for (const r of ranges) {
    if (pos >= r.from && pos < r.to) return true;
    if (r.from > pos) break; // ranges are sorted — no later range can contain pos
  }
  return false;
}

/** Merge overlapping/adjacent ranges into a minimal sorted set. */
export function mergeRanges(ranges: VisibleRange[]): VisibleRange[] {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const merged: VisibleRange[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const curr = sorted[i];
    if (curr.from <= last.to) {
      merged[merged.length - 1] = { from: last.from, to: Math.max(last.to, curr.to) };
    } else {
      merged.push(curr);
    }
  }
  return merged;
}

/** Snapshot CM6's live visibleRanges into a plain array of {from, to}. */
export function snapshotRanges(ranges: readonly { from: number; to: number }[]): VisibleRange[] {
  return ranges.map(r => ({ from: r.from, to: r.to }));
}

function mapVisibleRanges(
  ranges: readonly VisibleRange[],
  changes: ChangeSet,
): VisibleRange[] {
  return mergeRanges(
    ranges.map((range) => {
      const from = changes.mapPos(range.from, 1);
      const to = changes.mapPos(range.to, -1);
      return { from, to: Math.max(from, to) };
    }),
  );
}

function rangeIntersectsRanges(
  from: number,
  to: number,
  ranges: readonly VisibleRange[],
): boolean {
  for (const range of ranges) {
    if (from === to) {
      if (from >= range.from && from < range.to) return true;
      if (range.from > from) break;
      continue;
    }
    if (from < range.to && to > range.from) return true;
    if (range.from >= to) break;
  }
  return false;
}

function filterDecorationSetInRanges(
  decorations: DecorationSet,
  filterRanges: readonly VisibleRange[],
  keep: (from: number, to: number) => boolean,
): DecorationSet {
  let nextDecorations = decorations;
  for (const range of filterRanges) {
    nextDecorations = nextDecorations.update({
      filterFrom: range.from,
      filterTo: range.to,
      filter: (from, to) => keep(from, to),
    });
  }
  return nextDecorations;
}

function collectDecorationStartsInRanges(
  decorations: DecorationSet,
  ranges: readonly VisibleRange[],
  excludeRanges: readonly VisibleRange[] = [],
): ReadonlySet<number> {
  const starts = new Set<number>();
  for (const range of ranges) {
    decorations.between(range.from, range.to, (from) => {
      if (excludeRanges.length > 0 && isPositionInRanges(from, excludeRanges)) {
        return;
      }
      starts.add(from);
    });
  }
  return starts;
}

const NO_SKIP = () => false;

/**
 * Collect function signature for cursor-sensitive view plugins.
 *
 * @param view    The editor view.
 * @param ranges  Ranges to iterate (full visibleRanges for a complete rebuild,
 *                or newly-visible ranges for a differential update).
 * @param skip    Returns true for node start positions already processed in a
 *                previous viewport.  Always returns false during full rebuilds.
 */
export type CursorSensitiveCollectFn = (
  view: EditorView,
  ranges: readonly VisibleRange[],
  skip: (nodeFrom: number) => boolean,
) => Range<Decoration>[];

/**
 * Optional doc-change invalidation callback for cursor-sensitive view plugins.
 *
 * Return dirty ranges in the NEW document when mapped decorations can be
 * retained outside those fragments. Return `null` to force a full rebuild for
 * the current update.
 */
export type CursorSensitiveDocChangeRangesFn = (
  update: ViewUpdate,
) => readonly VisibleRange[] | null;

/**
 * Optional selection/focus invalidation callback for cursor-sensitive view plugins.
 *
 * Return dirty ranges in the CURRENT document when selection/focus changes can
 * be handled incrementally. Return `null` to force a full rebuild.
 */
export type CursorSensitiveContextChangeRangesFn = (
  update: ViewUpdate,
) => readonly VisibleRange[] | null;

/**
 * Factory for cursor-sensitive ViewPlugins with differential viewport updates.
 *
 * On structural / cursor changes (doc, selection, focus, tree) the plugin
 * performs a full rebuild via `collectFn`.  On pure viewport changes (scroll)
 * it diffs both newly-visible and newly-hidden fragments, evicts stale
 * offscreen decorations, and only builds decorations for the newly-visible
 * ranges — avoiding a full rescan while keeping work bounded to the current
 * viewport (#578, split from #443, refined in #854).
 *
 * @param collectFn  Collects decoration ranges.  Receives explicit ranges
 *                   (instead of reading view.visibleRanges) and a `skip`
 *                   predicate to avoid re-processing boundary-straddling
 *                   nodes from a previous viewport.
 * @param options    Optional overrides:
 *   - selectionCheck: replaces the default `update.selectionSet` condition.
 *     Allows narrowing selection-triggered rebuilds (e.g. only when the cursor
 *     crosses a sensitive node boundary).  Receives the ViewUpdate and should
 *     return true when a full rebuild is needed.
 *   - contextChangeRanges: opt-in incremental selection/focus invalidation.
 *     Return dirty ranges in the current document when selection/focus changes
 *     can be handled incrementally, or `null` to force a full rebuild.
 *   - docChangeRanges: opt-in incremental doc-change invalidation. Return
 *     dirty ranges in the new document when mapping retained decorations
 *     outside those fragments is safe, or `null` to force a full rebuild.
 *   - extraRebuildCheck: additional conditions that trigger a full rebuild
 *     (e.g. cache field changes for the image-render plugin).
 *   - pluginSpec: additional PluginSpec fields (e.g. eventHandlers).
 */
export function createCursorSensitiveViewPlugin(
  collectFn: CursorSensitiveCollectFn,
  options?: {
    selectionCheck?: (update: ViewUpdate) => boolean;
    contextChangeRanges?: CursorSensitiveContextChangeRangesFn;
    docChangeRanges?: CursorSensitiveDocChangeRangesFn;
    extraRebuildCheck?: (update: ViewUpdate) => boolean;
    pluginSpec?: Omit<PluginSpec<PluginValue>, "decorations">;
  },
): Extension {
  class CursorSensitivePlugin implements PluginValue {
    decorations!: DecorationSet;
    private coveredRanges!: VisibleRange[];

    constructor(view: EditorView) {
      this.rebuild(view);
    }

    private rebuild(view: EditorView): void {
      const items = collectFn(view, view.visibleRanges, NO_SKIP);
      this.decorations = buildDecorations(items);
      this.coveredRanges = snapshotRanges(view.visibleRanges);
    }

    private updateVisibleRanges(
      view: EditorView,
      baseDecorations: DecorationSet,
      previousCoveredRanges: readonly VisibleRange[],
      dirtyRanges: readonly VisibleRange[],
    ): void {
      const currentVisibleRanges = snapshotRanges(view.visibleRanges);
      const visibleDirtyRanges = mergeRanges(
        dirtyRanges.filter((range) =>
          rangeIntersectsRanges(range.from, range.to, currentVisibleRanges)
        ),
      );
      const staleRanges = diffVisibleRanges(currentVisibleRanges, previousCoveredRanges);
      const missingVisible = diffVisibleRanges(previousCoveredRanges, currentVisibleRanges);
      const rebuildRanges = mergeRanges([...visibleDirtyRanges, ...missingVisible]);
      const filterRanges = mergeRanges([...visibleDirtyRanges, ...staleRanges]);

      let nextDecorations = filterRanges.length > 0
        ? filterDecorationSetInRanges(
            baseDecorations,
            filterRanges,
            (from, to) =>
              rangeIntersectsRanges(from, to, currentVisibleRanges) &&
              !rangeIntersectsRanges(from, to, visibleDirtyRanges),
          )
        : baseDecorations;

      if (rebuildRanges.length > 0) {
        const retainedStarts = collectDecorationStartsInRanges(
          nextDecorations,
          currentVisibleRanges,
          visibleDirtyRanges,
        );
        const skip = (pos: number) => retainedStarts.has(pos);
        const newItems = collectFn(view, rebuildRanges, skip);
        if (newItems.length > 0) {
          nextDecorations = nextDecorations.update({
            add: newItems,
            sort: true,
          });
        }
      }

      this.decorations = nextDecorations;
      this.coveredRanges = currentVisibleRanges;
    }

    private incrementalViewportUpdate(update: ViewUpdate): void {
      this.updateVisibleRanges(update.view, this.decorations, this.coveredRanges, []);
    }

    private incrementalDocUpdate(
      update: ViewUpdate,
      dirtyRanges: readonly VisibleRange[],
    ): void {
      const mappedCoveredRanges = mapVisibleRanges(this.coveredRanges, update.changes);
      this.updateVisibleRanges(
        update.view,
        this.decorations.map(update.changes),
        mappedCoveredRanges,
        dirtyRanges,
      );
    }

    private incrementalContextUpdate(
      update: ViewUpdate,
      dirtyRanges: readonly VisibleRange[],
    ): void {
      this.updateVisibleRanges(update.view, this.decorations, this.coveredRanges, dirtyRanges);
    }

    update(update: ViewUpdate): void {
      const contextDirtyRanges = options?.contextChangeRanges?.(update);
      const selectionNeedsRebuild = contextDirtyRanges === undefined
        ? (options?.selectionCheck ? options.selectionCheck(update) : update.selectionSet)
        : contextDirtyRanges === null;
      const extraNeedsRebuild = options?.extraRebuildCheck?.(update) ?? false;

      if (update.docChanged) {
        const docDirtyRanges = options?.docChangeRanges?.(update);
        let dirtyRanges: readonly VisibleRange[] | null | undefined;
        if (docDirtyRanges === undefined) {
          dirtyRanges = undefined;
        } else if (contextDirtyRanges === undefined || docDirtyRanges === null) {
          dirtyRanges = docDirtyRanges;
        } else if (contextDirtyRanges === null) {
          dirtyRanges = null;
        } else {
          dirtyRanges = mergeRanges([...docDirtyRanges, ...contextDirtyRanges]);
        }
        const needsFullRebuild =
          selectionNeedsRebuild ||
          (contextDirtyRanges === undefined && update.focusChanged) ||
          extraNeedsRebuild ||
          dirtyRanges === null ||
          dirtyRanges === undefined;

        if (needsFullRebuild) {
          this.rebuild(update.view);
          return;
        }

        this.incrementalDocUpdate(update, dirtyRanges);
        return;
      }

      if (
        syntaxTree(update.state) !== syntaxTree(update.startState) ||
        extraNeedsRebuild
      ) {
        this.rebuild(update.view);
        return;
      }

      if (contextDirtyRanges !== undefined) {
        if (contextDirtyRanges === null) {
          this.rebuild(update.view);
          return;
        }
        if (contextDirtyRanges.length > 0 || update.viewportChanged) {
          this.incrementalContextUpdate(update, contextDirtyRanges);
        }
        return;
      }

      if (selectionNeedsRebuild || update.focusChanged) {
        this.rebuild(update.view);
        return;
      }

      if (update.viewportChanged) {
        this.incrementalViewportUpdate(update);
      }
    }
  }

  return ViewPlugin.fromClass(CursorSensitivePlugin, {
    ...options?.pluginSpec,
    decorations: (v) => v.decorations,
  });
}

/**
 * Factory that creates a CM6 ViewPlugin producing DecorationSet.
 *
 * Eliminates the repeated boilerplate of:
 *   class Foo implements PluginValue {
 *     decorations: DecorationSet;
 *     constructor(view) { this.decorations = buildFn(view); }
 *     update(u) { if (shouldUpdate(u)) this.decorations = buildFn(u.view); }
 *   }
 *   ViewPlugin.fromClass(Foo, { decorations: v => v.decorations })
 *
 * @param buildFn  Pure function that computes the DecorationSet from the view.
 * @param options  Optional overrides:
 *   - shouldUpdate: custom predicate (defaults to structural-only: docChanged / tree).
 *   - pluginSpec: additional PluginSpec fields (e.g., eventHandlers) merged with
 *     the decorations accessor.
 */
export function createSimpleViewPlugin(
  buildFn: (view: EditorView) => DecorationSet,
  options?: {
    shouldUpdate?: (update: ViewUpdate) => boolean;
    pluginSpec?: Omit<PluginSpec<PluginValue>, "decorations">;
  },
): Extension {
  const shouldUpdate = options?.shouldUpdate ?? defaultShouldUpdate;

  class SimpleViewPlugin implements PluginValue {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildFn(view);
    }

    update(update: ViewUpdate): void {
      if (shouldUpdate(update)) {
        this.decorations = buildFn(update.view);
      }
    }
  }

  return ViewPlugin.fromClass(SimpleViewPlugin, {
    ...options?.pluginSpec,
    decorations: (v) => v.decorations,
  });
}

/**
 * Default rebuild predicate for StateField-based decoration providers.
 *
 * Returns true only for structural changes: docChanged or syntaxTree changed.
 * Fields that need cursor-sensitivity should use `cursorSensitiveShouldRebuild`
 * or provide a custom predicate.
 *
 * Previously this also included selection and focusEffect — but those caused
 * multiplicative cursor-move cost across the rendering stack (#443).
 */
export function defaultShouldRebuild(tr: Transaction): boolean {
  return (
    tr.docChanged ||
    syntaxTree(tr.state) !== syntaxTree(tr.startState)
  );
}

/**
 * Cursor-sensitive rebuild predicate for StateField-based decoration providers.
 *
 * Returns true for structural changes (doc/tree), plus selection changes and
 * focusEffect. Use this for fields that show/hide source based on cursor
 * proximity (e.g., math-render, sidenote-render, fence-guide, fenced-block-core).
 */
export function cursorSensitiveShouldRebuild(tr: Transaction): boolean {
  return (
    tr.docChanged ||
    tr.selection !== undefined ||
    tr.effects.some((e) => e.is(focusEffect)) ||
    syntaxTree(tr.state) !== syntaxTree(tr.startState)
  );
}

/**
 * Factory that creates a CM6 StateField providing DecorationSet.
 *
 * @param builder         Pure function that computes the DecorationSet from state.
 * @param shouldRebuild   Predicate that decides when to rebuild. Defaults to
 *                        docChanged || syntaxTree changed.
 *                        When `mapOnDocChanged` is true, this predicate should
 *                        NOT include `docChanged` — the factory handles it via map.
 * @param mapOnDocChanged When true, text edits use `value.map(tr.changes)` instead
 *                        of full rebuild. This preserves RangeSet chunk identity,
 *                        which makes CM6's DOM reconciliation ~10x cheaper (shared
 *                        chunk shortcut in RangeSet.compare). Only safe for fields
 *                        whose decorations depend on tree structure, not text content.
 */
export function createDecorationsField(
  builder: (state: EditorState) => DecorationSet,
  shouldRebuild?: (tr: Transaction) => boolean,
  mapOnDocChanged?: boolean,
): StateField<DecorationSet> {
  const predicate = shouldRebuild ?? defaultShouldRebuild;

  return StateField.define<DecorationSet>({
    create(state) {
      return builder(state);
    },

    update(value, tr) {
      if (predicate(tr)) {
        return builder(tr.state);
      }
      if (mapOnDocChanged && tr.docChanged) {
        return value.map(tr.changes);
      }
      return value;
    },

    provide(field) {
      return EditorView.decorations.from(field);
    },
  });
}

/**
 * Iterate the syntax tree within visible ranges, skip nodes where the
 * cursor is inside, and call `buildItem` for each remaining match.
 *
 * Consolidates the repeated pattern of:
 *   for (const { from, to } of view.visibleRanges) {
 *     syntaxTree(view.state).iterate({ from, to, enter(node) {
 *       if (nodeTypes.has(node.name)) return;
 *       if (cursorInRange(view, node.from, node.to)) return;
 *       buildItem(node, items);
 *     }});
 *   }
 *
 * Returns the accumulated decoration ranges. The caller can pass them
 * to `buildDecorations()` or `Decoration.set(items, true)`.
 *
 * @param view        The editor view (used for visible ranges and cursor).
 * @param nodeTypes   Set of Lezer node type names to match.
 * @param buildItem   Callback invoked for each matching node outside the cursor.
 *                    Receives the SyntaxNodeRef and the accumulator array.
 *                    Return false to prevent descending into children.
 * @param options     Optional overrides for differential viewport updates:
 *   - ranges: explicit ranges to iterate (defaults to view.visibleRanges).
 *   - skip: predicate returning true for node start positions already
 *     processed in a previous viewport (prevents duplicate decorations
 *     for nodes straddling the old/new boundary).
 */
export function collectNodeRangesExcludingCursor(
  view: EditorView,
  nodeTypes: ReadonlySet<string>,
  // biome-ignore lint/suspicious/noConfusingVoidType: CM6-style callback convention; false means skip, void means continue
  buildItem: (node: SyntaxNodeRef, items: Range<Decoration>[]) => false | void,
  options?: {
    ranges?: readonly VisibleRange[];
    skip?: (nodeFrom: number) => boolean;
  },
): Range<Decoration>[] {
  const items: Range<Decoration>[] = [];
  const tree = syntaxTree(view.state);
  const ranges = options?.ranges ?? view.visibleRanges;
  const skip = options?.skip;

  for (const { from, to } of ranges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (!nodeTypes.has(node.name)) return;
        if (cursorInRange(view, node.from, node.to) || skip?.(node.from)) {
          return false;
        }
        return buildItem(node, items);
      },
    });
  }

  return items;
}

/**
 * Create a simple text element — shared DOM helper for RenderWidget.createDOM().
 *
 * Many widgets produce a single element whose only properties are tag, class,
 * and text content. This helper extracts that 3-line pattern into a single
 * call so widget createDOM() bodies stay concise.
 *
 * Unlike createSimpleTextWidget (which produces a singleton WidgetType), this
 * function is a plain DOM builder. The calling widget class still owns eq().
 *
 * @param tagName   HTML element tag (e.g. "span", "sup").
 * @param className CSS class for the element.
 * @param text      Text content of the element.
 */
export function makeTextElement(
  tagName: string,
  className: string,
  text: string,
): HTMLElement {
  const el = document.createElement(tagName);
  el.className = className;
  el.textContent = text;
  return el;
}

/** Shared spec for text-only render widgets. */
export interface SimpleTextRenderSpec {
  readonly tagName: string;
  readonly className: string;
  readonly text: string;
  readonly attrs?: Readonly<Record<string, string>>;
}

function serializeSimpleTextAttrs(
  attrs: Readonly<Record<string, string>> | undefined,
): string {
  if (!attrs) return "";
  return Object.entries(attrs)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}\0${value}`)
    .join("\0\0");
}

/**
 * Parameterized RenderWidget for the common "single text node + optional attrs"
 * pattern used by citations, labels, and small chrome widgets.
 */
export class SimpleTextRenderWidget extends RenderWidget {
  private readonly attrsKey: string;

  constructor(protected readonly spec: SimpleTextRenderSpec) {
    super();
    this.attrsKey = serializeSimpleTextAttrs(spec.attrs);
  }

  createDOM(): HTMLElement {
    const el = makeTextElement(
      this.spec.tagName,
      this.spec.className,
      this.spec.text,
    );
    if (this.spec.attrs) {
      for (const [name, value] of Object.entries(this.spec.attrs)) {
        el.setAttribute(name, value);
      }
    }
    return el;
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof SimpleTextRenderWidget &&
      this.spec.tagName === other.spec.tagName &&
      this.spec.className === other.spec.className &&
      this.spec.text === other.spec.text &&
      this.attrsKey === other.attrsKey
    );
  }
}

/**
 * Base class for widgets whose identity depends on math macro state.
 *
 * Widgets whose identity depends on math macros (MathWidget, BlockHeaderWidget)
 * cache `serializeMacros(macros)` in a `macrosKey` field and include it
 * in `eq()`. This base class captures that pattern so subclasses only
 * need to store the `macros` object and pass it here — the key is
 * computed once and available via `this.macrosKey`.
 *
 * Subclasses must still implement `createDOM()` and their own `eq()`,
 * calling `this.macrosKey` rather than re-computing it.
 */
export abstract class MacroAwareWidget extends RenderWidget {
  protected readonly macrosKey: string;

  constructor(macros: Record<string, string>) {
    super();
    this.macrosKey = serializeMacros(macros);
  }
}

/**
 * Factory that creates a lightweight WidgetType instance for simple text spans.
 *
 * Many render plugins need identical single-element widgets that differ only
 * in their tag, CSS class, and text content. This factory eliminates the
 * repeated boilerplate of defining a class with toDOM() and eq().
 *
 * Each call creates a unique class capturing the parameters in its closure.
 * Two instances produced by the same factory call are always equal (same DOM).
 * Instances from different factory calls are never equal (different classes).
 * This matches the typical use-case where widgets are module-level singletons.
 *
 * @param tagName   HTML tag for the element (e.g. "span").
 * @param className CSS class applied to the element.
 * @param text      Text content of the element.
 * @returns A WidgetType instance whose DOM matches the given parameters.
 *
 * @example
 * const openParenWidget = createSimpleTextWidget("span", "cf-block-title-paren", "(");
 */
export function createSimpleTextWidget(
  tagName: string,
  className: string,
  text: string,
): WidgetType {
  // Each factory call creates a unique class so cross-call eq() always returns
  // false (instances with different parameters are never confused as equal).
  class SimpleTextWidget extends WidgetType {
    toDOM(): HTMLElement {
      const el = document.createElement(tagName);
      el.className = className;
      el.textContent = text;
      return el;
    }

    // Two instances of the same SimpleTextWidget class are always equal:
    // the captured (tagName, className, text, title) are identical by construction.
    eq(other: WidgetType): boolean {
      return other instanceof SimpleTextWidget;
    }
  }

  return new SimpleTextWidget();
}
