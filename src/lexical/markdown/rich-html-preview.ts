import MarkdownIt from "markdown-it";
import markdownItAttrs from "markdown-it-attrs";
import markdownItFootnote from "markdown-it-footnote";
import markdownItMark from "markdown-it-mark";
import markdownItTaskLists from "markdown-it-task-lists";
import markdownItTexmath from "markdown-it-texmath";
import katex from "katex";

import { buildKatexOptions } from "../../lib/katex-options";
import { parseFrontmatter, type FrontmatterConfig } from "../../lib/frontmatter";
import { scanReferenceRevealTokens } from "../../lib/reference-tokens";
import {
  buildPreviewFencedDivRaw,
  collectSpecialBlockRanges,
  parseDisplayMathRaw,
  parseStructuredFencedDivRaw,
} from "./block-syntax";
import { createFencedDivViewModel } from "./fenced-div-view-model";
import {
  renderReferenceDisplay,
  type RenderCitations,
} from "./reference-display";
import type { RenderIndex } from "./reference-index";
import { LEXICAL_NODE_CLASS } from "../../constants/lexical-css-classes";

interface RichHtmlOptions {
  readonly citations?: RenderCitations;
  readonly config?: FrontmatterConfig;
  readonly docPath?: string;
  readonly renderIndex: RenderIndex;
  readonly resolveAssetUrl: (targetPath: string) => string | null;
}

interface MarkdownImageToken {
  attrGet: (name: string) => string | null;
  attrSet: (name: string, value: string) => void;
  content?: string;
}

interface MarkdownRendererFallback {
  renderToken: (tokens: unknown[], idx: number, opts: unknown) => string;
}

interface MarkdownRenderEnv {
  readonly coflatRenderOptions: RichHtmlOptions;
}

// markdown-it rendering is synchronous today, so a simple stack is enough to
// thread per-call options through the shared renderer. Revisit this before
// introducing any async render path.
const markdownRenderOptionsStack: RichHtmlOptions[] = [];

function encodeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function encodeAttr(text: string): string {
  return encodeHtml(text).replaceAll("'", "&#39;");
}

function currentMarkdownRenderOptions(): RichHtmlOptions | null {
  return markdownRenderOptionsStack[markdownRenderOptionsStack.length - 1] ?? null;
}

function createMarkdownRenderEnv(options: RichHtmlOptions): MarkdownRenderEnv {
  return {
    coflatRenderOptions: options,
  };
}

function optionsFromMarkdownRenderEnv(env: unknown): RichHtmlOptions | null {
  if (typeof env !== "object" || env === null) {
    return null;
  }

  const value = Reflect.get(env, "coflatRenderOptions");
  return typeof value === "object" && value !== null
    ? value as RichHtmlOptions
    : null;
}

function withMarkdownRenderOptions<T>(
  options: RichHtmlOptions,
  render: (env: MarkdownRenderEnv) => T,
): T {
  markdownRenderOptionsStack.push(options);
  try {
    return render(createMarkdownRenderEnv(options));
  } finally {
    markdownRenderOptionsStack.pop();
  }
}

function createMarkdownRenderer() {
  const md = new MarkdownIt({
    breaks: false,
    html: true,
    linkify: true,
  });

  md.use(markdownItAttrs);
  md.use(markdownItFootnote);
  md.use(markdownItMark);
  md.use(markdownItTaskLists, { enabled: true });
  md.use(markdownItTexmath, {
    delimiters: ["dollars", "brackets"],
    engine: {
      renderToString(content: string, mathRenderOptions: Record<string, unknown>) {
        const renderOptions = currentMarkdownRenderOptions();
        const {
          macros: _ignoredMacros,
          ...restMathRenderOptions
        } = mathRenderOptions;
        return katex.renderToString(
          content,
          {
            ...restMathRenderOptions,
            ...buildKatexOptions(Boolean(mathRenderOptions["displayMode"]), renderOptions?.config?.math),
          },
        );
      },
    },
  });

  const defaultImageRenderer = md.renderer.rules.image
    ?? ((tokens: unknown[], idx: number, opts: unknown, _env: unknown, self: MarkdownRendererFallback) =>
      self.renderToken(tokens, idx, opts));

  md.renderer.rules.image = (
    tokens: unknown[],
    idx: number,
    opts: unknown,
    env: unknown,
    self: MarkdownRendererFallback,
  ) => {
    const token = tokens[idx] as MarkdownImageToken;
    const src = token.attrGet("src") ?? "";
    const alt = token.content || "";
    const renderOptions = optionsFromMarkdownRenderEnv(env);
    const resolved = renderOptions?.resolveAssetUrl(src) ?? src;

    if (/\.pdf(?:$|[?#])/i.test(src)) {
      return `<div class="cf-lexical-media cf-lexical-media--pdf"><object data="${encodeAttr(resolved)}" type="application/pdf" class="cf-lexical-media-object" aria-label="${encodeAttr(alt || src)}"></object></div>`;
    }

    token.attrSet("src", resolved);
    token.attrSet("alt", alt);
    const existingClass = token.attrGet("class");
    token.attrSet("class", existingClass ? `${existingClass} cf-lexical-image` : "cf-lexical-image");
    return defaultImageRenderer(tokens, idx, opts, env, self);
  };

  return md;
}

const sharedMarkdownRenderer = createMarkdownRenderer();

function injectReferenceMarkup(
  markdown: string,
  renderIndex: RenderIndex,
  citations?: RenderCitations,
): string {
  const tokens = scanReferenceRevealTokens(markdown);
  if (tokens.length === 0) {
    return markdown;
  }

  const html: string[] = [];
  let cursor = 0;
  for (const token of tokens) {
    html.push(markdown.slice(cursor, token.from));
    html.push(
      `<span class="${LEXICAL_NODE_CLASS.REFERENCE}">${encodeHtml(renderReferenceDisplay(token.source, renderIndex, citations))}</span>`,
    );
    cursor = token.to;
  }
  html.push(markdown.slice(cursor));
  return html.join("");
}

function renderMarkdownChunk(markdown: string, options: RichHtmlOptions): string {
  const trimmed = markdown.trim();
  if (!trimmed) {
    return "";
  }
  return withMarkdownRenderOptions(options, (env) =>
    sharedMarkdownRenderer.render(
      injectReferenceMarkup(trimmed, options.renderIndex, options.citations),
      env,
    ));
}

export function renderMarkdownInlineHtml(markdown: string, options: RichHtmlOptions): string {
  return withMarkdownRenderOptions(options, (env) =>
    sharedMarkdownRenderer.renderInline(
      injectReferenceMarkup(markdown, options.renderIndex, options.citations),
      env,
    ));
}

export function renderFrontmatterHtml(raw: string): string {
  const parsed = parseFrontmatter(raw);
  if (parsed.config.title) {
    return `<header class="cf-lexical-title-shell"><h1 class="cf-lexical-frontmatter-title">${encodeHtml(parsed.config.title)}</h1></header>`;
  }
  return "";
}

export function renderDisplayMathHtml(raw: string, options: RichHtmlOptions): string {
  const parsed = parseDisplayMathRaw(raw);
  const equation = katex.renderToString(parsed.body, buildKatexOptions(true, options.config?.math));
  const label = parsed.id ? options.renderIndex.references.get(parsed.id)?.shortLabel : undefined;
  return `<div class="cf-lexical-display-math"><div class="cf-lexical-display-math-body">${equation}</div>${label ? `<div class="cf-lexical-display-math-label">${encodeHtml(label)}</div>` : ""}</div>`;
}

export function renderFencedDivHtml(raw: string, options: RichHtmlOptions): string {
  const parsed = parseStructuredFencedDivRaw(raw);
  const referenceLabel = parsed.id ? options.renderIndex.references.get(parsed.id)?.label : undefined;
  const viewModel = createFencedDivViewModel(parsed, {
    config: options.config,
    referenceLabel,
  });
  const titleHtml = parsed.titleMarkdown ? encodeHtml(parsed.titleMarkdown) : "";
  const bodyHtml = renderMarkdownRichHtml(parsed.body, options);

  if (viewModel.kind === "blockquote") {
    return `<blockquote class="cf-lexical-blockquote-shell">${bodyHtml}</blockquote>`;
  }

  const headerHtml = `<header class="cf-lexical-block-header"><span class="cf-lexical-block-label">${encodeHtml(viewModel.label)}</span>${titleHtml ? `<span class="cf-lexical-block-title">${titleHtml}</span>` : ""}</header>`;
  if (viewModel.kind === "captioned") {
    return `<section class="cf-lexical-block cf-lexical-block--${encodeAttr(parsed.blockType)}"><div class="cf-lexical-block-body">${bodyHtml}</div>${headerHtml}</section>`;
  }
  return `<section class="cf-lexical-block cf-lexical-block--${encodeAttr(parsed.blockType)}">${headerHtml}<div class="cf-lexical-block-body">${bodyHtml}</div></section>`;
}

export function renderMarkdownRichHtml(markdown: string, options: RichHtmlOptions): string {
  const ranges = collectSpecialBlockRanges(markdown);
  if (ranges.length === 0) {
    return renderMarkdownChunk(markdown, options);
  }

  const html: string[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (cursor < range.from) {
      html.push(renderMarkdownChunk(markdown.slice(cursor, range.from), options));
    }
    html.push(
      range.variant === "display-math"
        ? renderDisplayMathHtml(range.raw, options)
        : renderFencedDivHtml(range.raw, options),
    );
    cursor = range.to;
  }
  if (cursor < markdown.length) {
    html.push(renderMarkdownChunk(markdown.slice(cursor), options));
  }
  return html.join("");
}

export { buildPreviewFencedDivRaw };
