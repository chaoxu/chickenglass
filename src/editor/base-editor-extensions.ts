import { markdown } from "@codemirror/lang-markdown";
import type { LanguageDescription } from "@codemirror/language";
import { syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import type { MarkdownExtension } from "@lezer/markdown";
import { classHighlighter } from "@lezer/highlight";

import {
  projectConfigFacet,
  projectConfigStatusFacet,
  type ProjectConfig,
  type ProjectConfigStatus,
} from "../project-config";
import { markdownExtensions } from "../parser";
import { highlightExtension } from "../parser/highlight";
import { mathExtension } from "../parser/math-backslash";
import { strikethroughExtension } from "../parser/strikethrough";
export { sharedInlineRenderExtensions } from "../render/inline-render-extensions";

export const inlineMarkdownExtensions: MarkdownExtension[] = [
  mathExtension,
  highlightExtension,
  strikethroughExtension,
];

export function createProjectConfigExtensions(
  projectConfig?: ProjectConfig,
  projectConfigStatus?: ProjectConfigStatus,
): Extension[] {
  const extensions: Extension[] = [];
  if (projectConfig) extensions.push(projectConfigFacet.of(projectConfig));
  if (projectConfigStatus) extensions.push(projectConfigStatusFacet.of(projectConfigStatus));
  return extensions;
}

interface MarkdownLanguageOptions {
  extensions?: readonly MarkdownExtension[];
  codeLanguages?: readonly LanguageDescription[];
  syntaxHighlighting?: boolean;
}

export function createMarkdownLanguageExtensions({
  extensions = markdownExtensions,
  codeLanguages,
  syntaxHighlighting: includeSyntaxHighlighting = false,
}: MarkdownLanguageOptions = {}): Extension[] {
  const languageExtensions: Extension[] = [
    markdown({
      extensions,
      ...(codeLanguages ? { codeLanguages: [...codeLanguages] } : {}),
    }),
  ];

  if (includeSyntaxHighlighting) {
    languageExtensions.push(syntaxHighlighting(classHighlighter));
  }

  return languageExtensions;
}
