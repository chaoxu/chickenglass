import type { EditorState, Range } from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
import type { FencedDivInfo } from "../fenced-block/model";
import type { BlockPlugin } from "./block-plugin";
import type { PluginRenderAdapter } from "./plugin-render-adapter";

/**
 * Plugin-owned context for adding rich-mode block decorations.
 *
 * This module is the CM6-only surface for plugin decoration hooks. The neutral
 * BlockPlugin API stays free of CodeMirror state/decoration types.
 */
export interface BlockRenderDecorationContext {
  readonly adapter: PluginRenderAdapter;
  readonly state: EditorState;
  readonly div: FencedDivInfo;
  readonly items: Range<Decoration>[];
  readonly activeShell: boolean;
  readonly openerSourceActive: boolean;
}

/** Optional decoration hooks that the CM6 renderer dispatches generically. */
export interface BlockRenderDecorations {
  /** Add body decorations while the block is rendered in rich mode. */
  readonly addBodyDecorations?: (context: BlockRenderDecorationContext) => void;
}

export interface BlockPluginCm6Extension {
  readonly renderDecorations?: BlockRenderDecorations;
}

export type Cm6BlockPlugin = BlockPlugin & {
  readonly cm6?: BlockPluginCm6Extension;
};

export function withCm6BlockPlugin(
  plugin: BlockPlugin,
  cm6: BlockPluginCm6Extension,
): Cm6BlockPlugin {
  return { ...plugin, cm6 };
}

export function getCm6RenderDecorations(
  plugin: BlockPlugin,
): BlockRenderDecorations | undefined {
  return (plugin as Cm6BlockPlugin).cm6?.renderDecorations;
}
