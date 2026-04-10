import MarkdownIt from "markdown-it";
import markdownItAttrs from "markdown-it-attrs";
import markdownItFootnote from "markdown-it-footnote";
import markdownItMark from "markdown-it-mark";
import markdownItTaskLists from "markdown-it-task-lists";
import markdownItTexmath from "markdown-it-texmath";
import katex from "katex";

import { extractHeadingDefinitions } from "../app/markdown/headings";
import { extractMarkdownBlocks, extractMarkdownEquations } from "../app/markdown/labels";
import { formatBibEntry } from "../citations/bibliography";
import { BLOCK_MANIFEST_ENTRIES } from "../constants/block-manifest";
import type { BibStore } from "../citations/bibtex-parser";
import type { CslProcessor } from "../citations/csl-processor";
import { buildKatexOptions } from "../lib/katex-options";
import type { FrontmatterConfig } from "../lib/frontmatter";
import { parseFrontmatter } from "../lib/frontmatter";
import { normalizeProjectPath, resolveProjectPathFromDocument } from "../lib/project-paths";

const BRACKETED_REFERENCE_RE = /\[(?:[^\]\n\\]|\\.)*?@[^\]\n]*\]/g;
const NARRATIVE_REFERENCE_RE = /(^|[^\w])@([A-Za-z0-9_][\w.:-]*)/g;
const FOOTNOTE_DEFINITION_RE = /^\[\^([^\]]+)\]:\s*(.*)$/;
const FENCED_DIV_START_RE = /^\s*(:{3,})(.*)$/;
const DISPLAY_MATH_DOLLAR_START_RE = /^\s*\$\$(?!\$).*$/;
const DISPLAY_MATH_DOLLAR_END_RE = /^\s*\$\$(?:\s+\{#[^}]+\})?\s*$/;
const DISPLAY_MATH_BRACKET_START_RE = /^\s*\\\[\s*$/;
const DISPLAY_MATH_BRACKET_END_RE = /^\s*\\\](?:\s+\{#[^}]+\})?\s*$/;

const BLOCK_LABELS = new Map<string, string>([
  ["include", "Include"],
  ...BLOCK_MANIFEST_ENTRIES.map((entry) => [
    entry.name,
    entry.title ?? `${entry.name.slice(0, 1).toUpperCase()}${entry.name.slice(1)}`,
  ] as const),
]);

const BLOCK_MANIFEST_BY_NAME = new Map(
  BLOCK_MANIFEST_ENTRIES.map((entry) => [entry.name, entry] as const),
);

export interface RenderReferenceEntry {
  readonly blockType?: string;
  readonly kind: "block" | "citation" | "equation" | "footnote" | "heading";
  readonly label: string;
  readonly shortLabel?: string;
}

export interface RenderIndex {
  readonly footnotes: ReadonlyMap<string, number>;
  readonly references: ReadonlyMap<string, RenderReferenceEntry>;
}

export interface RenderCitations {
  readonly cslProcessor?: CslProcessor;
  readonly store: BibStore;
}

export interface FencedDivInfo {
  readonly blockType: string;
  readonly body: string;
  readonly id?: string;
  readonly title?: string;
}

export interface ParsedFencedDivBlock extends FencedDivInfo {
  readonly attrsRaw?: string;
  readonly bodyMarkdown: string;
  readonly closingFence: string;
  readonly fence: string;
  readonly titleMarkdown?: string;
  readonly titleKind: "attribute" | "implicit" | "none" | "trailing";
}

export interface DisplayMathInfo {
  readonly body: string;
  readonly id?: string;
}

export interface ParsedDisplayMathBlock extends DisplayMathInfo {
  readonly bodyMarkdown: string;
  readonly closingDelimiter: "\\]" | "$$";
  readonly labelSuffix: string;
  readonly openingDelimiter: "\\[" | "$$";
}

export interface MarkdownTable {
  readonly alignments: ReadonlyArray<"center" | "left" | "right" | null>;
  readonly headers: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<ReadonlyArray<string>>;
}

export interface ParsedReferenceToken {
  readonly bracketed: boolean;
  readonly ids: readonly string[];
  readonly locators: readonly (string | undefined)[];
}

interface RichHtmlOptions {
  readonly citations?: RenderCitations;
  readonly config?: FrontmatterConfig;
  readonly docPath?: string;
  readonly renderIndex: RenderIndex;
  readonly resolveAssetUrl: (targetPath: string) => string | null;
}

interface SpecialBlockRange {
  readonly from: number;
  readonly raw: string;
  readonly to: number;
  readonly variant: "display-math" | "fenced-div";
}

interface MarkdownImageToken {
  attrGet: (name: string) => string | null;
  attrSet: (name: string, value: string) => void;
  content?: string;
}

interface MarkdownRendererFallback {
  renderToken: (tokens: unknown[], idx: number, opts: unknown) => string;
}

function resolveBlockTitle(blockType: string, config?: FrontmatterConfig): string {
  const override = config?.blocks?.[blockType];
  if (override && typeof override === "object" && typeof override.title === "string") {
    return override.title;
  }
  return humanizeBlockType(blockType);
}

function resolveBlockNumbering(
  blockType: string,
  config?: FrontmatterConfig,
): { readonly counterGroup?: string; readonly numbered: boolean } {
  const manifestEntry = BLOCK_MANIFEST_BY_NAME.get(blockType);
  const override = config?.blocks?.[blockType];
  const disabled = override === false;
  const overrideConfig = override && typeof override === "object" ? override : null;
  const numbered = disabled
    ? false
    : (overrideConfig?.numbered ?? manifestEntry?.numbered ?? blockType !== "include");
  if (!numbered) {
    return { numbered: false };
  }

  if (overrideConfig?.counter === null) {
    return { numbered: true };
  }

  const baseCounterGroup = overrideConfig?.counter
    ?? manifestEntry?.counterGroup
    ?? blockType;

  return {
    counterGroup: config?.numbering === "global" ? "__global__" : baseCounterGroup,
    numbered: true,
  };
}

function nextCounter(counters: Map<string, number>, blockType: string): number {
  const next = (counters.get(blockType) ?? 0) + 1;
  counters.set(blockType, next);
  return next;
}

export function humanizeBlockType(blockType: string | undefined): string {
  if (!blockType) {
    return "Block";
  }
  return BLOCK_LABELS.get(blockType) ?? `${blockType.slice(0, 1).toUpperCase()}${blockType.slice(1)}`;
}

function normalizeBlockType(blockType: string | undefined, title: string | undefined): string {
  if (blockType) {
    return blockType;
  }
  const trimmedTitle = title?.trim();
  if (!trimmedTitle) {
    return "block";
  }
  return trimmedTitle.toLowerCase().replace(/\s+/g, "-");
}

export function buildRenderIndex(doc: string, config?: FrontmatterConfig): RenderIndex {
  const references = new Map<string, RenderReferenceEntry>();
  const footnotes = new Map<string, number>();

  let headingCounter = 0;
  for (const heading of extractHeadingDefinitions(doc)) {
    if (!heading.id) {
      continue;
    }
    headingCounter += 1;
    references.set(heading.id, {
      kind: "heading",
      label: heading.number ? `Section ${heading.number}` : heading.text,
      shortLabel: heading.number || `${headingCounter}`,
    });
  }

  let equationCounter = 0;
  for (const equation of extractMarkdownEquations(doc)) {
    if (!equation.id) {
      continue;
    }
    equationCounter += 1;
    references.set(equation.id, {
      kind: "equation",
      label: `Equation (${equationCounter})`,
      shortLabel: `(${equationCounter})`,
    });
  }

  const blockCounters = new Map<string, number>();
  for (const block of extractMarkdownBlocks(doc)) {
    if (!block.id) {
      continue;
    }
    const blockType = normalizeBlockType(block.blockType, block.title);
    const labelBase = resolveBlockTitle(blockType, config);
    const numbering = resolveBlockNumbering(blockType, config);
    const number = numbering.numbered && numbering.counterGroup
      ? nextCounter(blockCounters, numbering.counterGroup)
      : undefined;
    references.set(block.id, {
      kind: "block",
      blockType,
      label: number !== undefined ? `${labelBase} ${number}` : labelBase,
      shortLabel: number !== undefined ? `${labelBase} ${number}` : labelBase,
    });
  }

  let footnoteCounter = 0;
  for (const line of doc.split("\n")) {
    const match = line.match(FOOTNOTE_DEFINITION_RE);
    if (!match || footnotes.has(match[1])) {
      continue;
    }
    footnoteCounter += 1;
    footnotes.set(match[1], footnoteCounter);
  }

  return {
    footnotes,
    references,
  };
}

export function buildFootnoteDefinitionMap(doc: string): ReadonlyMap<string, string> {
  const definitions = new Map<string, string>();
  const lines = doc.split("\n");

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    const match = line.match(FOOTNOTE_DEFINITION_RE);
    if (!match || definitions.has(match[1])) {
      continue;
    }

    let endLineIndex = lineIndex;
    for (let innerIndex = lineIndex + 1; innerIndex < lines.length; innerIndex += 1) {
      const innerLine = lines[innerIndex] ?? "";
      if (/^\s*$/.test(innerLine)) {
        break;
      }
      if (!/^\s{2,4}\S/.test(innerLine)) {
        break;
      }
      endLineIndex = innerIndex;
    }

    const parsed = parseFootnoteDefinition(lines.slice(lineIndex, endLineIndex + 1).join("\n"));
    if (parsed) {
      definitions.set(parsed.id, parsed.body);
      lineIndex = endLineIndex;
    }
  }

  return definitions;
}

export function buildStaticAssetUrl(docPath: string | undefined, targetPath: string): string | null {
  const basePath = docPath ? resolveProjectPathFromDocument(docPath, targetPath) : normalizeProjectPath(targetPath);
  if (!basePath || targetPath.startsWith("/") || targetPath.startsWith("\\") || /^(?:https?:|data:)/i.test(targetPath)) {
    return targetPath || null;
  }
  const segments = basePath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return null;
  }
  return `/demo/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

export function parseDisplayMathRaw(raw: string): DisplayMathInfo {
  const lines = raw.split("\n");
  if (lines[0]?.trimStart().startsWith("$$")) {
    const lastLine = lines[lines.length - 1] ?? "";
    const body = lines.length === 1
      ? raw.slice(raw.indexOf("$$") + 2, raw.lastIndexOf("$$")).trim()
      : lines.slice(1, -1).join("\n").trim();
    return {
      body,
      id: lastLine.match(/\{#([^}]+)\}\s*$/)?.[1],
    };
  }
  return {
    body: lines.slice(1, -1).join("\n").trim(),
    id: (lines[lines.length - 1] ?? "").match(/\{#([^}]+)\}\s*$/)?.[1],
  };
}

export function parseFencedDivRaw(raw: string): FencedDivInfo {
  const parsed = parseStructuredFencedDivRaw(raw);
  return {
    blockType: parsed.blockType,
    body: parsed.body,
    id: parsed.id,
    title: parsed.title,
  };
}

export function parseStructuredFencedDivRaw(raw: string): ParsedFencedDivBlock {
  const lines = raw.split("\n");
  const opener = lines[0] ?? "";
  const fenceMatch = opener.match(/^\s*(:{3,})/);
  const fence = fenceMatch?.[1] ?? ":::";
  const header = opener.replace(/^\s*:{3,}/, "").trim();
  const closingFence = lines[lines.length - 1]?.trim() || fence;
  const bodyMarkdown = lines.slice(1, -1).join("\n");
  const body = bodyMarkdown.trim();

  if (!header.startsWith("{")) {
    return {
      blockType: normalizeBlockType(undefined, header || "block"),
      body,
      bodyMarkdown,
      closingFence,
      fence,
      title: header || undefined,
      titleMarkdown: header || undefined,
      titleKind: header ? "implicit" : "none",
    };
  }

  const attrsEnd = header.indexOf("}");
  const attrs = attrsEnd >= 0 ? header.slice(0, attrsEnd + 1) : header;
  const trailingTitle = attrsEnd >= 0 ? header.slice(attrsEnd + 1).trim() : "";
  const titleAttrMatch = attrs.match(/\btitle=(?:"([^"]*)"|'([^']*)')/);
  const classes = [...attrs.matchAll(/\.([A-Za-z][\w-]*)/g)].map((match) => match[1]);
  const id = attrs.match(/#([A-Za-z0-9_][\w.:-]*)/)?.[1];

  return {
    attrsRaw: attrs,
    blockType: normalizeBlockType(classes[0], trailingTitle || titleAttrMatch?.[1] || titleAttrMatch?.[2]),
    body,
    bodyMarkdown,
    closingFence,
    fence,
    id,
    title: titleAttrMatch?.[1] || titleAttrMatch?.[2] || trailingTitle || undefined,
    titleMarkdown: trailingTitle || titleAttrMatch?.[1] || titleAttrMatch?.[2] || undefined,
    titleKind: trailingTitle
      ? "trailing"
      : titleAttrMatch
        ? "attribute"
        : "none",
  };
}

export function serializeFencedDivRaw(
  parsed: ParsedFencedDivBlock,
  overrides?: {
    readonly bodyMarkdown?: string;
    readonly titleMarkdown?: string;
  },
): string {
  const bodyMarkdown = overrides?.bodyMarkdown ?? parsed.bodyMarkdown;
  const titleMarkdown = overrides?.titleMarkdown ?? parsed.titleMarkdown ?? "";
  const attrsRaw = parsed.titleKind === "attribute" && parsed.attrsRaw
    ? parsed.attrsRaw.replace(
        /\btitle=(?:"([^"]*)"|'([^']*)')/,
        `title=${JSON.stringify(titleMarkdown)}`,
      )
    : parsed.attrsRaw;
  const header = attrsRaw
    ? `${attrsRaw}${parsed.titleKind === "trailing" && titleMarkdown ? ` ${titleMarkdown}` : ""}`
    : titleMarkdown || parsed.title || humanizeBlockType(parsed.blockType);
  return [
    `${parsed.fence}${header ? ` ${header}` : ""}`,
    bodyMarkdown,
    parsed.closingFence,
  ].join("\n");
}

export function buildPreviewFencedDivRaw({
  blockType,
  bodyMarkdown,
  id,
  title,
}: {
  readonly blockType?: string;
  readonly bodyMarkdown: string;
  readonly id?: string;
  readonly title?: string;
}): string {
  const attrs: string[] = [];
  if (blockType) {
    attrs.push(`.${blockType}`);
  }
  if (id) {
    attrs.push(`#${id}`);
  }

  const header = attrs.length > 0
    ? `{${attrs.join(" ")}}${title ? ` ${title}` : ""}`
    : title ?? "";

  return [
    `:::${header ? ` ${header}` : ""}`,
    bodyMarkdown,
    ":::",
  ].join("\n");
}

export function parseStructuredDisplayMathRaw(raw: string): ParsedDisplayMathBlock {
  const lines = raw.split("\n");
  const firstLine = lines[0]?.trim() ?? "";
  const lastLine = lines[lines.length - 1]?.trim() ?? "";
  if (firstLine.startsWith("\\[")) {
    return {
      body: lines.slice(1, -1).join("\n").trim(),
      bodyMarkdown: lines.slice(1, -1).join("\n"),
      closingDelimiter: "\\]",
      id: lastLine.match(/\{#([^}]+)\}\s*$/)?.[1],
      labelSuffix: lastLine.replace(/^\\\]/, "").trim(),
      openingDelimiter: "\\[",
    };
  }

  const bodyMarkdown = lines.length === 1
    ? raw.slice(raw.indexOf("$$") + 2, raw.lastIndexOf("$$"))
    : lines.slice(1, -1).join("\n");

  return {
    body: bodyMarkdown.trim(),
    bodyMarkdown,
    closingDelimiter: "$$",
    id: lastLine.match(/\{#([^}]+)\}\s*$/)?.[1],
    labelSuffix: lastLine.replace(/^\$\$/, "").trim(),
    openingDelimiter: "$$",
  };
}

export function serializeDisplayMathRaw(
  parsed: ParsedDisplayMathBlock,
  bodyMarkdown: string,
): string {
  const closingLine = `${parsed.closingDelimiter}${parsed.labelSuffix ? ` ${parsed.labelSuffix}` : ""}`;
  return [
    parsed.openingDelimiter,
    bodyMarkdown,
    closingLine,
  ].join("\n");
}

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

function createMarkdownRenderer(options: RichHtmlOptions) {
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
      renderToString(content: string, renderOptions: Record<string, unknown>) {
        return katex.renderToString(
          content,
          {
            ...buildKatexOptions(Boolean(renderOptions["displayMode"]), options.config?.math),
            ...renderOptions,
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
    _env: unknown,
    self: MarkdownRendererFallback,
  ) => {
    const token = tokens[idx] as MarkdownImageToken;
    const src = token.attrGet("src") ?? "";
    const alt = token.content || "";
    const resolved = options.resolveAssetUrl(src) ?? src;

    if (/\.pdf(?:$|[?#])/i.test(src)) {
      return `<div class="cf-lexical-media cf-lexical-media--pdf"><object data="${encodeAttr(resolved)}" type="application/pdf" class="cf-lexical-media-object" aria-label="${encodeAttr(alt || src)}"></object></div>`;
    }

    token.attrSet("src", resolved);
    token.attrSet("alt", alt);
    const existingClass = token.attrGet("class");
    token.attrSet("class", existingClass ? `${existingClass} cf-lexical-image` : "cf-lexical-image");
    return defaultImageRenderer(tokens, idx, opts, _env, self);
  };

  return md;
}

function formatReferenceItem(id: string, renderIndex: RenderIndex, bracketed: boolean): string {
  const entry = renderIndex.references.get(id);
  if (!entry) {
    return id;
  }
  if (entry.kind === "equation") {
    return bracketed ? (entry.shortLabel ?? entry.label) : entry.label;
  }
  return entry.label;
}

function normalizeCitationLocators(
  locators: readonly (string | undefined)[],
): (string | undefined)[] | undefined {
  return locators.some((locator) => locator != null) ? [...locators] : undefined;
}

function stripCitationWrapper(rendered: string): string {
  const trimmed = rendered.trim();
  if (
    (trimmed.startsWith("(") && trimmed.endsWith(")"))
    || (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function formatCitationPart(
  id: string,
  citations: RenderCitations | undefined,
  narrative: boolean,
  locator?: string,
): string {
  if (!citations?.store.has(id)) {
    return id;
  }

  if (!citations.cslProcessor) {
    if (narrative) {
      return id;
    }
    return `[${id}]`;
  }

  if (narrative) {
    return citations.cslProcessor.citeNarrative(id);
  }

  const rendered = citations.cslProcessor.cite([id], locator ? [locator] : undefined);
  return stripCitationWrapper(rendered);
}

export function parseReferenceToken(raw: string): ParsedReferenceToken | null {
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const body = raw.slice(1, -1);
    const ids: string[] = [];
    const locators: Array<string | undefined> = [];

    for (const match of body.matchAll(/@([A-Za-z0-9_][\w.:-]*)/g)) {
      const id = match[1];
      ids.push(id);
      const nextFrom = (match.index ?? 0) + match[0].length;
      const remainder = body.slice(nextFrom);
      const nextMatch = remainder.search(/@([A-Za-z0-9_][\w.:-]*)/);
      const locatorRaw = nextMatch >= 0 ? remainder.slice(0, nextMatch) : remainder;
      const locator = locatorRaw.replace(/^[\s;,:-]+|[\s;,:-]+$/g, "").trim() || undefined;
      locators.push(locator);
    }

    return ids.length > 0
      ? { bracketed: true, ids, locators }
      : null;
  }

  const match = raw.match(/@([A-Za-z0-9_][\w.:-]*)/);
  if (!match) {
    return null;
  }
  return {
    bracketed: false,
    ids: [match[1]],
    locators: [undefined],
  };
}

function renderBracketedReferenceDisplay(
  parsed: ParsedReferenceToken,
  renderIndex: RenderIndex,
  citations?: RenderCitations,
): string {
  const ids = [...parsed.ids];
  if (ids.length === 0) {
    return "";
  }

  const allCitations = ids.every((id) => citations?.store.has(id));
  if (allCitations && citations?.cslProcessor) {
    return citations.cslProcessor.cite(ids, normalizeCitationLocators(parsed.locators));
  }

  const rendered = ids.map((id, index) =>
    citations?.store.has(id)
      ? formatCitationPart(id, citations, false, parsed.locators[index])
      : formatReferenceItem(id, renderIndex, true));
  const hasOnlyLocalReferences = ids.every((id) => renderIndex.references.has(id));
  if (hasOnlyLocalReferences) {
    return rendered.join("; ");
  }
  const hasOnlyEquations = ids.every((id) => renderIndex.references.get(id)?.kind === "equation");
  if (hasOnlyEquations && rendered.length === 1) {
    return rendered[0];
  }
  return `[${rendered.join("; ")}]`;
}

export function renderReferenceDisplay(
  raw: string,
  renderIndex: RenderIndex,
  citations?: RenderCitations,
): string {
  const parsed = parseReferenceToken(raw);
  if (!parsed) {
    return raw;
  }

  if (parsed.bracketed) {
    return renderBracketedReferenceDisplay(parsed, renderIndex, citations);
  }

  const [id] = parsed.ids;
  if (citations?.store.has(id)) {
    return formatCitationPart(id, citations, true);
  }
  return formatReferenceItem(id, renderIndex, false);
}

export function formatCitationPreview(id: string, citations?: RenderCitations): string | null {
  const entry = citations?.store.get(id);
  if (!entry) {
    return null;
  }
  return formatBibEntry(entry);
}

function injectReferenceMarkup(
  markdown: string,
  renderIndex: RenderIndex,
  citations?: RenderCitations,
): string {
  const placeholders: string[] = [];
  let next = markdown.replace(BRACKETED_REFERENCE_RE, (raw) => {
    const placeholder = `__COFLAT_REF_${placeholders.length}__`;
    placeholders.push(`<span class="cf-lexical-reference">${encodeHtml(renderReferenceDisplay(raw, renderIndex, citations))}</span>`);
    return placeholder;
  });

  next = next.replace(NARRATIVE_REFERENCE_RE, (_raw, prefix: string, id: string) =>
    `${prefix}<span class="cf-lexical-reference">${encodeHtml(renderReferenceDisplay(`@${id}`, renderIndex, citations))}</span>`);

  return next.replace(/__COFLAT_REF_(\d+)__/g, (_raw, indexText: string) =>
    placeholders[Number(indexText)] ?? "");
}

function renderMarkdownChunk(markdown: string, options: RichHtmlOptions): string {
  const trimmed = markdown.trim();
  if (!trimmed) {
    return "";
  }
  const md = createMarkdownRenderer(options);
  return md.render(injectReferenceMarkup(trimmed, options.renderIndex, options.citations));
}

function matchDisplayMathRange(lines: readonly string[], startLineIndex: number): number | null {
  const startLine = lines[startLineIndex] ?? "";
  if (DISPLAY_MATH_DOLLAR_START_RE.test(startLine)) {
    for (let lineIndex = startLineIndex + 1; lineIndex < lines.length; lineIndex += 1) {
      if (DISPLAY_MATH_DOLLAR_END_RE.test(lines[lineIndex] ?? "")) {
        return lineIndex;
      }
    }
  }
  if (DISPLAY_MATH_BRACKET_START_RE.test(startLine)) {
    for (let lineIndex = startLineIndex + 1; lineIndex < lines.length; lineIndex += 1) {
      if (DISPLAY_MATH_BRACKET_END_RE.test(lines[lineIndex] ?? "")) {
        return lineIndex;
      }
    }
  }
  return null;
}

function collectSpecialBlockRanges(markdown: string): SpecialBlockRange[] {
  const ranges: SpecialBlockRange[] = [];
  const lines = markdown.split("\n");
  let offset = 0;
  const lineOffsets: number[] = [];
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";

    const fencedMatch = line.match(FENCED_DIV_START_RE);
    if (fencedMatch) {
      const fenceLength = fencedMatch[1].length;
      if (!/^\s*$/.test(fencedMatch[2])) {
        const closingFence = new RegExp(`^\\s*:{${fenceLength},}\\s*$`);
        let depth = 0;
        for (let innerIndex = lineIndex; innerIndex < lines.length; innerIndex += 1) {
          const innerLine = lines[innerIndex] ?? "";
          const innerMatch = innerLine.match(FENCED_DIV_START_RE);
          if (innerMatch && !/^\s*$/.test(innerMatch[2])) {
            depth += 1;
          } else if (closingFence.test(innerLine)) {
            depth -= 1;
            if (depth === 0) {
              const from = lineOffsets[lineIndex];
              const to = lineOffsets[innerIndex] + innerLine.length;
              ranges.push({
                from,
                raw: markdown.slice(from, to),
                to,
                variant: "fenced-div",
              });
              lineIndex = innerIndex;
              break;
            }
          }
        }
      }
      continue;
    }

    const displayMathEndLine = matchDisplayMathRange(lines, lineIndex);
    if (displayMathEndLine !== null) {
      const from = lineOffsets[lineIndex];
      const to = lineOffsets[displayMathEndLine] + (lines[displayMathEndLine] ?? "").length;
      ranges.push({
        from,
        raw: markdown.slice(from, to),
        to,
        variant: "display-math",
      });
      lineIndex = displayMathEndLine;
    }
  }

  return ranges;
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

function renderInlineMarkdownHtml(markdown: string, options: RichHtmlOptions): string {
  const md = createMarkdownRenderer(options);
  return md.renderInline(injectReferenceMarkup(markdown, options.renderIndex, options.citations));
}

export function renderFencedDivHtml(raw: string, options: RichHtmlOptions): string {
  const parsed = parseFencedDivRaw(raw);
  const referenceEntry = parsed.id ? options.renderIndex.references.get(parsed.id) : undefined;
  const titleHtml = parsed.title
    ? renderInlineMarkdownHtml(parsed.title, options)
    : "";
  const bodyHtml = parsed.blockType === "include"
    ? `<p class="cf-lexical-include-path">${encodeHtml(parsed.body)}</p>`
    : renderMarkdownRichHtml(parsed.body, options);
  const label = referenceEntry?.label ?? resolveBlockTitle(parsed.blockType, options.config);
  const isCaptionBlock = parsed.blockType === "figure" || parsed.blockType === "table";

  if (parsed.blockType === "gist" || parsed.blockType === "youtube") {
    return `<section class="cf-lexical-block cf-lexical-block--embed cf-lexical-block--${encodeAttr(parsed.blockType)}"><div class="cf-lexical-block-label">${encodeHtml(label)}</div><a class="cf-lexical-embed-link" href="${encodeAttr(parsed.body)}" target="_blank" rel="noreferrer">${encodeHtml(parsed.body)}</a></section>`;
  }

  if (parsed.blockType === "blockquote") {
    return `<blockquote class="cf-lexical-blockquote-shell">${bodyHtml}</blockquote>`;
  }

  const headerHtml = `<header class="cf-lexical-block-header"><span class="cf-lexical-block-label">${encodeHtml(label)}</span>${titleHtml ? `<span class="cf-lexical-block-title">${titleHtml}</span>` : ""}</header>`;
  if (isCaptionBlock) {
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

export function parseFootnoteDefinition(raw: string): { id: string; body: string } | null {
  const lines = raw.split("\n");
  const match = lines[0]?.match(FOOTNOTE_DEFINITION_RE);
  if (!match) {
    return null;
  }
  const bodyLines = [match[2], ...lines.slice(1).map((line) => line.replace(/^\s{2,4}/, ""))];
  return {
    id: match[1],
    body: bodyLines.join("\n").trim(),
  };
}

export function serializeFootnoteDefinition(id: string, body: string): string {
  const lines = body.split("\n");
  const [firstLine = "", ...restLines] = lines;
  return [
    `[^${id}]: ${firstLine}`,
    ...restLines.map((line) => `  ${line}`),
  ].join("\n");
}

export function parseMarkdownImage(raw: string): { alt: string; src: string } | null {
  const match = raw.trim().match(/^!\[([^\]]*)\]\(([^)\n]+)\)\s*$/);
  if (!match) {
    return null;
  }
  return {
    alt: match[1],
    src: match[2].trim(),
  };
}

function splitTableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().replaceAll("\\|", "|"));
}

function parseAlignment(cell: string): "center" | "left" | "right" | null {
  const trimmed = cell.trim();
  const starts = trimmed.startsWith(":");
  const ends = trimmed.endsWith(":");
  if (starts && ends) {
    return "center";
  }
  if (starts) {
    return "left";
  }
  if (ends) {
    return "right";
  }
  return null;
}

function formatAlignment(align: "center" | "left" | "right" | null): string {
  if (align === "center") {
    return ":---:";
  }
  if (align === "left") {
    return ":---";
  }
  if (align === "right") {
    return "---:";
  }
  return "---";
}

function serializeTableRow(cells: readonly string[]): string {
  return `| ${cells.join(" | ")} |`;
}

export function parseMarkdownTable(raw: string): MarkdownTable | null {
  const lines = raw.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length < 2) {
    return null;
  }

  const headers = splitTableCells(lines[0]);
  const divider = splitTableCells(lines[1]);
  if (headers.length === 0 || divider.length !== headers.length) {
    return null;
  }

  const alignments = divider.map(parseAlignment);
  const rows = lines.slice(2).map((line) => splitTableCells(line));

  return {
    alignments,
    headers,
    rows: rows.map((row) => {
      const normalized = [...row];
      while (normalized.length < headers.length) {
        normalized.push("");
      }
      return normalized.slice(0, headers.length);
    }),
  };
}

export function serializeMarkdownTable(table: MarkdownTable): string {
  return [
    serializeTableRow(table.headers),
    serializeTableRow(table.alignments.map(formatAlignment)),
    ...table.rows.map((row) => serializeTableRow(row)),
  ].join("\n");
}
