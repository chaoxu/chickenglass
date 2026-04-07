import { markdown } from "@codemirror/lang-markdown";
import type { LanguageDescription } from "@codemirror/language";
import { syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import type { MarkdownExtension } from "@lezer/markdown";
import { classHighlighter } from "@lezer/highlight";

import { projectConfigFacet, type ProjectConfig } from "../project-config";
import { markdownExtensions } from "../parser";
import { highlightExtension } from "../parser/highlight";
import { mathExtension } from "../parser/math-backslash";
import { strikethroughExtension } from "../parser/strikethrough";
import { markdownRenderPlugin } from "../render/markdown-render";
import { mathRenderPlugin } from "../render/math-render";

export const inlineMarkdownExtensions: MarkdownExtension[] = [
  mathExtension,
  highlightExtension,
  strikethroughExtension,
];

export const sharedInlineRenderExtensions: Extension[] = [
  mathRenderPlugin,
  markdownRenderPlugin,
];

export function createProjectConfigExtensions(projectConfig?: ProjectConfig): Extension[] {
  return projectConfig ? [projectConfigFacet.of(projectConfig)] : [];
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
