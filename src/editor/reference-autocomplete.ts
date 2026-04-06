import {
  autocompletion,
  type Completion,
  CompletionContext,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import type { EditorState, Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { CslJsonItem } from "../citations/bibtex-parser";
import {
  buildCitationPreviewContent,
  formatCitationPreview,
} from "../citations/citation-preview";
import { bibDataField } from "../citations/citation-render";
import { CSS } from "../constants/css-classes";
import {
  blockCounterField,
  getPlugin,
  pluginRegistryField,
} from "../plugins";
import { buildCrossrefCompletionPreviewContent } from "../render/hover-preview";
import { documentAnalysisField } from "../semantics/codemirror-source";

const CROSSREF_SECTION = { name: "Cross-references", rank: 0 } as const;
const CITATION_SECTION = { name: "Citations", rank: 1 } as const;
const FORBIDDEN_CONTEXT_TYPES = new Set([
  "CodeText",
  "DisplayMath",
  "FencedCode",
  "InlineCode",
  "InlineMath",
  "URL",
]);
const REF_ID_CHAR_RE = /[\w:./'-]/;
const REF_QUERY_RE = /^[\w:./'-]*$/;
const COMPLETE_REF_PART_RE = /^\s*@[A-Za-z0-9_][\w:./'-]*(?:\s*,.*)?\s*$/;
const ACTIVE_REF_PART_RE = /^\s*@([\w:./'-]*)$/;
const NARRATIVE_REF_RE = /(?:^|[^\w@])@([\w:./'-]*)$/;

export type ReferenceCompletionKind =
  | "block"
  | "citation"
  | "equation"
  | "heading";

export interface ReferenceCompletionMatch {
  readonly kind: "bracketed" | "narrative";
  readonly from: number;
  readonly to: number;
  readonly query: string;
}

export interface ReferenceCompletionCandidate {
  readonly id: string;
  readonly kind: ReferenceCompletionKind;
  readonly detail?: string;
  readonly info?: string;
  readonly preview?: string;
}

interface ReferenceAutocompleteCompletion extends Completion {
  readonly referenceCompletionKind: ReferenceCompletionKind;
  readonly citationPreview?: string;
}

function isReferenceIdChar(ch: string | undefined): boolean {
  return ch !== undefined && REF_ID_CHAR_RE.test(ch);
}

function findTokenEnd(after: string): number {
  let i = 0;
  while (i < after.length && isReferenceIdChar(after[i])) {
    i += 1;
  }
  return i;
}

function isForbiddenCompletionContext(state: EditorState, pos: number): boolean {
  const tree = syntaxTree(state);
  const safePos = Math.max(0, Math.min(pos, state.doc.length));

  for (const bias of [1, -1, 0] as const) {
    let node: SyntaxNode | null = tree.resolveInner(safePos, bias);
    while (node) {
      if (FORBIDDEN_CONTEXT_TYPES.has(node.name)) return true;
      node = node.parent;
    }
  }

  return false;
}

function findBracketedReferenceMatch(
  lineFrom: number,
  before: string,
  after: string,
  pos: number,
): ReferenceCompletionMatch | null {
  const openBracket = before.lastIndexOf("[");
  if (openBracket < 0 || openBracket < before.lastIndexOf("]")) {
    return null;
  }

  const contentBefore = before.slice(openBracket + 1);
  if (!contentBefore.trimStart().startsWith("@")) {
    return null;
  }

  const parts = contentBefore.split(";");
  const activePart = parts[parts.length - 1] ?? "";
  const stableParts = parts.slice(0, -1);

  if (stableParts.some((part) => !COMPLETE_REF_PART_RE.test(part))) {
    return null;
  }

  if (activePart.includes(",")) {
    return null;
  }

  const activeMatch = ACTIVE_REF_PART_RE.exec(activePart);
  if (!activeMatch) {
    return null;
  }

  const activePartOffset = contentBefore.length - activePart.length;
  const atOffset = activePart.indexOf("@");
  if (atOffset < 0) {
    return null;
  }

  const from = lineFrom + openBracket + 1 + activePartOffset + atOffset + 1;
  const to = pos + findTokenEnd(after);
  return {
    kind: "bracketed",
    from,
    to,
    query: activeMatch[1] ?? "",
  };
}

function findNarrativeReferenceMatch(
  pos: number,
  before: string,
  after: string,
): ReferenceCompletionMatch | null {
  const match = NARRATIVE_REF_RE.exec(before);
  if (!match || match.index === undefined) {
    return null;
  }

  const fullMatch = match[0];
  const atIndex = before.length - fullMatch.length + fullMatch.lastIndexOf("@");
  const from = pos - (before.length - atIndex - 1);
  return {
    kind: "narrative",
    from,
    to: pos + findTokenEnd(after),
    query: match[1] ?? "",
  };
}

export function findReferenceCompletionMatch(
  state: EditorState,
  pos: number,
): ReferenceCompletionMatch | null {
  if (isForbiddenCompletionContext(state, pos)) {
    return null;
  }

  const line = state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);
  const after = line.text.slice(pos - line.from);

  return (
    findBracketedReferenceMatch(line.from, before, after, pos)
    ?? findNarrativeReferenceMatch(pos, before, after)
  );
}

function formatCitationAuthor(item: CslJsonItem): string {
  const author = item.author?.[0];
  const base =
    author?.family
    ?? author?.literal
    ?? author?.given
    ?? item.publisher
    ?? item.id;

  return item.author && item.author.length > 1
    ? `${base} et al.`
    : base;
}

function formatCitationYear(item: CslJsonItem): string | undefined {
  const year = item.issued?.["date-parts"]?.[0]?.[0];
  return typeof year === "number" ? String(year) : undefined;
}

function formatCitationDetail(item: CslJsonItem): string {
  const author = formatCitationAuthor(item);
  const year = formatCitationYear(item);
  return year ? `${author} ${year}` : author;
}

function isCitationCompletion(
  completion: Completion,
): completion is ReferenceAutocompleteCompletion & {
  readonly referenceCompletionKind: "citation";
  readonly citationPreview: string;
} {
  const referenceCompletion = completion as Partial<ReferenceAutocompleteCompletion>;
  return referenceCompletion.referenceCompletionKind === "citation"
    && typeof referenceCompletion.citationPreview === "string";
}

function isSemanticReferenceCompletion(
  completion: Completion,
): completion is ReferenceAutocompleteCompletion & {
  readonly referenceCompletionKind: "block" | "equation" | "heading";
} {
  const referenceCompletion = completion as Partial<ReferenceAutocompleteCompletion>;
  return referenceCompletion.referenceCompletionKind === "block"
    || referenceCompletion.referenceCompletionKind === "equation"
    || referenceCompletion.referenceCompletionKind === "heading";
}

function renderReferenceCompletionPreview(
  completion: Completion,
  _state: EditorState,
  view: EditorView,
): Node | null {
  if (isCitationCompletion(completion)) {
    return buildCitationPreviewContent(completion.citationPreview);
  }

  return isSemanticReferenceCompletion(completion)
    ? buildCrossrefCompletionPreviewContent(view, completion.label)
    : null;
}

function referenceCompletionOptionClass(completion: Completion): string {
  if (isCitationCompletion(completion)) {
    return `${CSS.referenceCompletionPreview} ${CSS.referenceCompletionCitation}`;
  }

  return isSemanticReferenceCompletion(completion)
    ? `${CSS.referenceCompletionPreview} ${CSS.referenceCompletionCrossref}`
    : "";
}

export function collectReferenceCompletionCandidates(
  state: EditorState,
): ReferenceCompletionCandidate[] {
  const candidates = new Map<string, ReferenceCompletionCandidate>();
  const analysis = state.field(documentAnalysisField, false);
  const counters = state.field(blockCounterField, false);
  const registry = state.field(pluginRegistryField, false);

  if (analysis && counters) {
    for (const block of counters.blocks) {
      if (!block.id || candidates.has(block.id)) continue;
      const plugin = registry ? getPlugin(registry, block.type) : undefined;
      const title = plugin?.title ?? block.type;
      const blockSemantics = analysis.fencedDivByFrom.get(block.from);
      candidates.set(block.id, {
        id: block.id,
        kind: "block",
        detail: `${title} ${block.number}`,
        info: blockSemantics?.title,
      });
    }
  }

  if (analysis) {
    for (const equation of analysis.equations) {
      if (candidates.has(equation.id)) continue;
      candidates.set(equation.id, {
        id: equation.id,
        kind: "equation",
        detail: `Eq. (${equation.number})`,
        info: equation.latex,
      });
    }

    for (const heading of analysis.headings) {
      if (!heading.id || candidates.has(heading.id)) continue;
      candidates.set(heading.id, {
        id: heading.id,
        kind: "heading",
        detail: heading.number ? `Section ${heading.number}` : "Section",
        info: heading.text,
      });
    }
  }

  const store = state.field(bibDataField, false)?.store;
  if (store) {
    for (const item of store.values()) {
      if (candidates.has(item.id)) continue;
      candidates.set(item.id, {
        id: item.id,
        kind: "citation",
        detail: formatCitationDetail(item),
        preview: formatCitationPreview(item),
      });
    }
  }

  return [...candidates.values()];
}

function candidateToCompletion(
  candidate: ReferenceCompletionCandidate,
): ReferenceAutocompleteCompletion {
  switch (candidate.kind) {
    case "block":
      return {
        label: candidate.id,
        referenceCompletionKind: "block",
        section: CROSSREF_SECTION,
        sortText: `0-${candidate.id}`,
        type: "constant",
      };
    case "equation":
      return {
        label: candidate.id,
        referenceCompletionKind: "equation",
        section: CROSSREF_SECTION,
        sortText: `1-${candidate.id}`,
        type: "constant",
      };
    case "heading":
      return {
        label: candidate.id,
        referenceCompletionKind: "heading",
        section: CROSSREF_SECTION,
        sortText: `2-${candidate.id}`,
        type: "namespace",
      };
    case "citation":
      return {
        citationPreview: candidate.preview,
        label: candidate.id,
        referenceCompletionKind: "citation",
        section: CITATION_SECTION,
        sortText: `3-${candidate.id}`,
        type: "variable",
      };
  }
}

export const referenceCompletionSource: CompletionSource = (
  context: CompletionContext,
) => {
  const match = findReferenceCompletionMatch(context.state, context.pos);
  if (!match) {
    return null;
  }

  const options = collectReferenceCompletionCandidates(context.state).map(candidateToCompletion);
  if (options.length === 0) {
    return null;
  }

  return {
    from: match.from,
    to: match.to,
    options,
    validFor: REF_QUERY_RE,
  };
};

export const referenceAutocompleteExtension: Extension = autocompletion({
  activateOnTyping: true,
  activateOnTypingDelay: 0,
  addToOptions: [{ render: renderReferenceCompletionPreview, position: 90 }],
  optionClass: referenceCompletionOptionClass,
  override: [referenceCompletionSource],
  tooltipClass: () => CSS.referenceCompletionTooltip,
});
