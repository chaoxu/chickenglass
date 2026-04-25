/**
 * Types for the block plugin system.
 *
 * A BlockPlugin describes how a fenced div class is rendered and numbered.
 * Plugins register themselves in the PluginRegistry, and the renderer
 * looks up the registry to decide how to display each fenced div.
 */

import type { EditorState, Range } from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
import type { CaptionPosition, HeaderPosition, SpecialBehavior } from "../constants/block-manifest";
import type { FencedDivInfo } from "../fenced-block/model";
import type { PluginRenderAdapter } from "./plugin-render-adapter";

/** Attributes extracted from a fenced div and enriched with numbering info. */
export interface BlockAttrs {
  /** The plugin/class name (e.g. "theorem", "proof"). */
  readonly type: string;
  /** The id from the attribute block (e.g. "thm-1"). */
  readonly id?: string;
  /** The user-supplied title from the fenced div opening line. */
  readonly title?: string;
  /** The auto-assigned number (undefined if unnumbered). */
  readonly number?: number;
}

/**
 * Specification for rendering a block.
 *
 * Used by the CM6 ViewPlugin to create decorations.
 */
export interface BlockDecorationSpec {
  /** CSS class names to apply to the block wrapper. */
  readonly className: string;
  /** The header text (e.g. "Theorem 1" or "Proof"). */
  readonly header: string;
}

/**
 * Plugin-owned context for adding rich-mode block decorations.
 *
 * CM6-specific surface: leaks `EditorState` and `Range<Decoration>` because
 * decorations only exist in the CM6 rendering pipeline. Lives on the
 * BlockPlugin via the `cm6` namespace so non-CM6 consumers never need to
 * see these types.
 */
export interface BlockRenderDecorationContext {
  readonly adapter: PluginRenderAdapter;
  readonly state: EditorState;
  readonly div: FencedDivInfo;
  readonly items: Range<Decoration>[];
  readonly activeShell: boolean;
  readonly openerSourceActive: boolean;
}

/** Optional decoration hooks that the core renderer dispatches generically. */
export interface BlockRenderDecorations {
  /** Add body decorations while the block is rendered in rich mode. */
  readonly addBodyDecorations?: (context: BlockRenderDecorationContext) => void;
}

/**
 * CM6-specific extension to BlockPlugin. A future Lexical plugin surface
 * would add a sibling `lexical?: BlockPluginLexicalExtension` field; the
 * neutral core fields on BlockPlugin (name, numbered, title, counter,
 * specialBehavior, ...) stay unchanged.
 */
export interface BlockPluginCm6Extension {
  readonly renderDecorations?: BlockRenderDecorations;
}

/**
 * A block plugin defines how a fenced div class behaves.
 *
 * Plugins are registered in the PluginRegistry. The core editor
 * knows nothing about "theorem" or "proof" — all behavior comes
 * from plugins.
 */
export interface BlockPlugin {
  /** Class name that triggers this plugin (e.g. "theorem"). */
  readonly name: string;
  /**
   * Counter group name. Plugins sharing the same counter group
   * increment a single shared counter. If undefined, uses `name`
   * as the counter group when `numbered` is true.
   */
  readonly counter?: string;
  /** Whether this block type is auto-numbered. */
  readonly numbered: boolean;
  /** Display title shown in the rendered header (e.g. "Theorem"). */
  readonly title: string;
  /**
   * Special rendering behavior for this block type, mirroring BlockManifestEntry.
   *
   * - `"qed"`: appends a QED tombstone to the last content line (e.g. proof)
   * - `"blockquote"`: renders as a blockquote-style block
   * - `undefined`: standard numbered/unnumbered block
   */
  readonly specialBehavior?: SpecialBehavior;
  /**
   * Whether to show a rendered header label for this block type.
   *
   * Defaults to `true`. Set to `false` for blocks like blockquote that
   * render as styled content without a "Blockquote" label.
   *
   * When `false`, the header widget is still created (to hide the fence
   * syntax) but the label text is suppressed by omitting the `cf-block-header`
   * CSS class from the opening fence line decoration.
   */
  readonly displayHeader?: boolean;
  /**
   * Where to place the rendered caption/header label.
   *
   * - `"above"` (default): header on the opening fence line (theorem, definition, etc.)
   * - `"below"`: header on the last body line before the closing fence (figure, table)
   */
  readonly captionPosition?: CaptionPosition;
  /** Whether the rendered header is block-level or inline with the first body line. */
  readonly headerPosition?: HeaderPosition;
  /**
   * Surface-specific extensions. CM6 rendering hooks live under `cm6`; a
   * future Lexical extension would land under a sibling key. Neutral
   * consumers (registry lookup, counter, default rendering) ignore this.
   */
  readonly cm6?: BlockPluginCm6Extension;
  /** Produce a decoration spec from the block's attributes. */
  readonly render: (attrs: BlockAttrs) => BlockDecorationSpec;
}
