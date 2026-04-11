/**
 * Public composition seam for fenced code block rendering.
 *
 * Structure/cache ownership, decoration assembly, and hover behavior now live
 * in focused modules. This file keeps the stable public import surface and
 * composes the final CM6 extension.
 */

import { type Extension } from "@codemirror/state";
import { codeBlockDecorationField,
  docChangeTouchesCodeBlockContent,
  computeCodeBlockDirtyRegion,
  incrementalCodeBlockUpdate,} from "./code-block-decorations";
import { codeBlockHoverPlugin } from "./code-block-hover";
import {
  type CodeBlockInfo,
  codeBlockStructureField,
  collectCodeBlocks,
  getCodeBlockStructureRevision,
} from "../state/code-block-structure";
import {
  editorFocusField,
  focusTracker,
} from "./focus-state";

export {
  type CodeBlockInfo,
  codeBlockDecorationField as _codeBlockDecorationFieldForTest,
  codeBlockStructureField,
  codeBlockStructureField as _codeBlockStructureFieldForTest,
  collectCodeBlocks,
  docChangeTouchesCodeBlockContent as _docChangeTouchesCodeBlockContentForTest,
  computeCodeBlockDirtyRegion as _computeCodeBlockDirtyRegionForTest,
  getCodeBlockStructureRevision,
  incrementalCodeBlockUpdate as _incrementalCodeBlockUpdateForTest,
};

/** CM6 extension that renders fenced code blocks with language label and fence hiding. */
export const codeBlockRenderPlugin: Extension = [
  editorFocusField,
  focusTracker,
  codeBlockDecorationField,
  // Closing fence protection and atomic ranges are provided by the unified
  // fenceProtectionExtension in fence-protection.ts (#441).
  codeBlockHoverPlugin,
];
