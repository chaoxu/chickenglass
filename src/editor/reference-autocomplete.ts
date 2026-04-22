import {
  autocompletion,
  type Completion,
  CompletionContext,
  type CompletionSource,
  startCompletion,
} from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import type { EditorState, Extension } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import {
  buildCitationPreviewContent,
} from "../citations/citation-preview";
import { bibDataEffect, bibDataField } from "../state/bib-data";
import { CSS } from "../constants/css-classes";
import { findAncestor } from "../lib/syntax-tree-helpers";
import { getReferencePresentationModel } from "../references/presentation";
import { buildCrossrefCompletionPreviewContent } from "../render/hover-preview";
import { getEditorDocumentReferenceCatalog } from "../semantics/editor-reference-catalog";

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
    const node: SyntaxNode | null = tree.resolveInner(safePos, bias);
    if (findAncestor(node, (candidate) => FORBIDDEN_CONTEXT_TYPES.has(candidate.name))) {
      return true;
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
  const catalog = getEditorDocumentReferenceCatalog(state);
  const presentation = getReferencePresentationModel(state);

  for (const target of catalog.targets) {
    if (!target.id || candidates.has(target.id)) continue;

    switch (target.kind) {
      case "block":
        candidates.set(target.id, {
          id: target.id,
          kind: "block",
          detail: presentation.getDisplayText(target.id),
          info: target.title,
        });
        break;
      case "equation":
        candidates.set(target.id, {
          id: target.id,
          kind: "equation",
          detail: presentation.getDisplayText(target.id),
          info: target.text,
        });
        break;
      case "heading":
        candidates.set(target.id, {
          id: target.id,
          kind: "heading",
          detail: presentation.getDisplayText(target.id),
          info: target.title,
        });
        break;
    }
  }

  const store = state.field(bibDataField, false)?.store;
  if (store) {
    for (const item of store.values()) {
      if (candidates.has(item.id)) continue;
      candidates.set(item.id, {
        id: item.id,
        kind: "citation",
        detail: presentation.getDisplayText(item.id),
        preview: presentation.getPreviewText(item.id),
      });
    }
  }

  return [...candidates.values()];
}

function candidateDisplayLabel(candidate: ReferenceCompletionCandidate): string {
  switch (candidate.kind) {
    case "block":
      return candidate.info ?? candidate.detail ?? candidate.id;
    case "equation":
      return candidate.detail ?? candidate.id;
    case "heading":
      return candidate.info ?? candidate.detail ?? candidate.id;
    case "citation":
      return candidate.id;
  }
}

function candidateCompletionDetail(
  candidate: ReferenceCompletionCandidate,
): string | undefined {
  return candidate.kind === "citation" ? candidate.detail : candidate.id;
}

function candidateToCompletion(
  candidate: ReferenceCompletionCandidate,
): ReferenceAutocompleteCompletion {
  const displayLabel = candidateDisplayLabel(candidate);
  const baseCompletion = {
    detail: candidateCompletionDetail(candidate),
    label: candidate.id,
    ...(displayLabel !== candidate.id ? { displayLabel } : {}),
  } as const;

  switch (candidate.kind) {
    case "block":
      return {
        ...baseCompletion,
        referenceCompletionKind: "block",
        section: CROSSREF_SECTION,
        sortText: `0-${candidate.id}`,
      };
    case "equation":
      return {
        ...baseCompletion,
        referenceCompletionKind: "equation",
        section: CROSSREF_SECTION,
        sortText: `1-${candidate.id}`,
      };
    case "heading":
      return {
        ...baseCompletion,
        referenceCompletionKind: "heading",
        section: CROSSREF_SECTION,
        sortText: `2-${candidate.id}`,
      };
    case "citation":
      return {
        ...baseCompletion,
        citationPreview: candidate.preview,
        referenceCompletionKind: "citation",
        section: CITATION_SECTION,
        sortText: `3-${candidate.id}`,
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

function shouldRefreshReferenceCompletion(update: ViewUpdate): boolean {
  if (!update.transactions.some((tr) => tr.effects.some((effect) => effect.is(bibDataEffect)))) {
    return false;
  }

  const beforeBib = update.startState.field(bibDataField, false);
  const afterBib = update.state.field(bibDataField, false);
  if (beforeBib?.store === afterBib?.store) {
    return false;
  }

  const selection = update.state.selection.main;
  return selection.empty && findReferenceCompletionMatch(update.state, selection.head) !== null;
}

const refreshReferenceCompletionOnBibliographyUpdate = EditorView.updateListener.of((update) => {
  if (!shouldRefreshReferenceCompletion(update)) {
    return;
  }
  startCompletion(update.view);
});

export const referenceAutocompleteExtension: Extension = [
  autocompletion({
    activateOnTyping: true,
    activateOnTypingDelay: 0,
    addToOptions: [{ render: renderReferenceCompletionPreview, position: 90 }],
    optionClass: referenceCompletionOptionClass,
    override: [referenceCompletionSource],
    tooltipClass: () => CSS.referenceCompletionTooltip,
  }),
  refreshReferenceCompletionOnBibliographyUpdate,
];
