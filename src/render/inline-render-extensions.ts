import type { Extension } from "@codemirror/state";
import { markdownRenderPlugin } from "./markdown-render";
import { mathRenderPlugin } from "./math-render";

export const sharedInlineRenderExtensions: Extension[] = [
  mathRenderPlugin,
  markdownRenderPlugin,
];
