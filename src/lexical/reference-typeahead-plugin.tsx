import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { $isCodeNode } from "@lexical/code";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  type MenuRenderFn,
  type MenuTextMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import {
  $addUpdateTag,
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
  type LexicalNode,
  type TextNode,
} from "lexical";
import DOMPurify from "dompurify";

import { EditorChromePanel } from "./editor-chrome";
import { $createReferenceNode } from "./nodes/reference-node";
import { useLexicalRenderContext } from "./render-context";
import { COFLAT_NESTED_EDIT_TAG } from "./update-tags";
import {
  buildPreviewFencedDivRaw,
  formatCitationPreview,
  renderDisplayMathHtml,
  renderFencedDivHtml,
} from "./rendering";
import type { CslJsonItem } from "../citations/bibtex-parser";

const COMPLETE_REF_PART_RE = /^\s*@[A-Za-z0-9_][\w:./'-]*(?:\s*,.*)?\s*$/;
const ACTIVE_REF_PART_RE = /^(\s*@)([\w:./'-]*)$/;
const NARRATIVE_REF_RE = /(?:^|[^\w@])@([\w:./'-]*)$/;

export interface ReferenceCompletionMatch extends MenuTextMatch {
  readonly kind: "bracketed" | "narrative";
}

export interface ReferenceCompletionCandidate {
  readonly detail?: string;
  readonly id: string;
  readonly kind: "block" | "citation" | "equation" | "heading";
  readonly label: string;
  readonly previewHtml?: string;
  readonly previewText?: string;
}

export function applyBracketedReferenceCompletion(raw: string, nextId: string): string {
  if (!raw.startsWith("[")) {
    return `[@${nextId}`;
  }

  const body = raw.slice(1);
  const parts = body.split(";");
  const activePart = parts.pop() ?? "";
  const prefix = parts.length > 0 ? `${parts.join(";")};` : "";
  const activeMatch = ACTIVE_REF_PART_RE.exec(activePart);
  if (!activeMatch) {
    return raw;
  }

  return `[${prefix}${activeMatch[1]}${nextId}`;
}

function findBracketedReferenceCompletionMatch(text: string): ReferenceCompletionMatch | null {
  const openBracket = text.lastIndexOf("[");
  if (openBracket < 0 || openBracket < text.lastIndexOf("]")) {
    return null;
  }

  const clusterText = text.slice(openBracket);
  const contentBefore = clusterText.slice(1);
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

  return {
    kind: "bracketed",
    leadOffset: openBracket,
    matchingString: activeMatch[2] ?? "",
    replaceableString: clusterText,
  };
}

function findNarrativeReferenceCompletionMatch(text: string): ReferenceCompletionMatch | null {
  const match = NARRATIVE_REF_RE.exec(text);
  if (!match || match.index === undefined) {
    return null;
  }

  const fullMatch = match[0];
  const atIndex = text.length - fullMatch.length + fullMatch.lastIndexOf("@");
  return {
    kind: "narrative",
    leadOffset: atIndex,
    matchingString: match[1] ?? "",
    replaceableString: text.slice(atIndex),
  };
}

export function findReferenceCompletionMatch(text: string): ReferenceCompletionMatch | null {
  return (
    findBracketedReferenceCompletionMatch(text)
    ?? findNarrativeReferenceCompletionMatch(text)
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

function candidateSearchText(candidate: ReferenceCompletionCandidate): string {
  return [
    candidate.id,
    candidate.label,
    candidate.detail ?? "",
    candidate.previewText ?? "",
  ].join("\n").toLowerCase();
}

function candidateKindRank(kind: ReferenceCompletionCandidate["kind"]): number {
  switch (kind) {
    case "block":
      return 0;
    case "equation":
      return 1;
    case "heading":
      return 2;
    case "citation":
      return 3;
  }
}

function candidateQueryRank(candidate: ReferenceCompletionCandidate, query: string): number {
  if (!query) {
    return 0;
  }

  const normalizedQuery = query.toLowerCase();
  const id = candidate.id.toLowerCase();
  const label = candidate.label.toLowerCase();
  if (id === normalizedQuery) {
    return 0;
  }
  if (id.startsWith(normalizedQuery)) {
    return 1;
  }
  if (label.startsWith(normalizedQuery)) {
    return 2;
  }
  if (candidateSearchText(candidate).includes(normalizedQuery)) {
    return 3;
  }
  return Number.POSITIVE_INFINITY;
}

function filterReferenceCompletionCandidates(
  candidates: readonly ReferenceCompletionCandidate[],
  query: string,
): ReferenceCompletionCandidate[] {
  const normalizedQuery = query.trim().toLowerCase();
  return candidates
    .filter((candidate) =>
      !normalizedQuery || candidateSearchText(candidate).includes(normalizedQuery))
    .sort((left, right) => {
      const queryRank = candidateQueryRank(left, normalizedQuery) - candidateQueryRank(right, normalizedQuery);
      if (queryRank !== 0) {
        return queryRank;
      }

      const kindRank = candidateKindRank(left.kind) - candidateKindRank(right.kind);
      if (kindRank !== 0) {
        return kindRank;
      }

      return left.id.localeCompare(right.id);
    });
}

function collectReferenceCompletionCandidates(
  context: ReturnType<typeof useLexicalRenderContext>,
): ReferenceCompletionCandidate[] {
  const candidates = new Map<string, ReferenceCompletionCandidate>();
  const renderOptions = {
    citations: context.citations,
    config: context.config,
    docPath: context.docPath,
    renderIndex: context.renderIndex,
    resolveAssetUrl: context.resolveAssetUrl,
  } as const;

  for (const [id, definition] of context.labelGraph.uniqueDefinitionById) {
    const referenceEntry = context.renderIndex.references.get(id);
    if (definition.kind === "block" && definition.content != null) {
      const previewHtml = renderFencedDivHtml(buildPreviewFencedDivRaw({
        blockType: definition.blockType,
        bodyMarkdown: definition.content,
        id: definition.id,
        title: definition.title,
      }), renderOptions);
      candidates.set(id, {
        detail: id,
        id,
        kind: "block",
        label: definition.title?.trim() || referenceEntry?.label || id,
        previewHtml,
      });
      continue;
    }

    if (definition.kind === "equation" && definition.text) {
      const previewHtml = renderDisplayMathHtml(
        `$$\n${definition.text}\n$$${definition.id ? ` {#${definition.id}}` : ""}`,
        renderOptions,
      );
      candidates.set(id, {
        detail: id,
        id,
        kind: "equation",
        label: referenceEntry?.label || id,
        previewHtml,
      });
      continue;
    }

    if (definition.kind === "heading") {
      candidates.set(id, {
        detail: id,
        id,
        kind: "heading",
        label: definition.title?.trim() || referenceEntry?.label || id,
        previewText: referenceEntry?.label,
      });
    }
  }

  for (const item of context.citations.store.values()) {
    if (candidates.has(item.id)) {
      continue;
    }

    candidates.set(item.id, {
      detail: formatCitationDetail(item),
      id: item.id,
      kind: "citation",
      label: item.id,
      previewText: formatCitationPreview(item.id, context.citations) ?? undefined,
    });
  }

  return [...candidates.values()];
}

function isForbiddenReferenceCompletionContext(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
    return true;
  }

  if (selection.hasFormat("code")) {
    return true;
  }

  let node: LexicalNode | null = selection.anchor.getNode();
  while (node) {
    if ($isCodeNode(node)) {
      return true;
    }
    node = node.getParent();
  }

  return false;
}

class ReferenceCompletionOption extends MenuOption {
  candidate: ReferenceCompletionCandidate;

  constructor(candidate: ReferenceCompletionCandidate) {
    super(candidate.id);
    this.candidate = candidate;
  }
}

function ReferencePreviewHtml({
  className,
  html,
}: {
  readonly className: string;
  readonly html: string;
}) {
  const sanitized = useMemo(() => DOMPurify.sanitize(html), [html]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: sanitized }} />;
}

function ReferenceCompletionPreview({
  candidate,
}: {
  readonly candidate: ReferenceCompletionCandidate;
}) {
  if (candidate.kind === "citation") {
    return candidate.previewText ? (
      <div className="cf-citation-preview">{candidate.previewText}</div>
    ) : null;
  }

  if (candidate.kind === "heading") {
    return candidate.previewText ? (
      <div className="cf-reference-completion-content">
        <div className="cf-hover-preview-header">{candidate.previewText}</div>
      </div>
    ) : null;
  }

  if (!candidate.previewHtml) {
    return null;
  }

  return (
    <div className="cf-reference-completion-content">
      <ReferencePreviewHtml
        className="cf-reference-completion-rich-preview"
        html={candidate.previewHtml}
      />
    </div>
  );
}

function ReferenceCompletionMenu({
  options,
  selectedIndex,
  selectOptionAndCleanUp,
  setHighlightedIndex,
}: {
  readonly options: readonly ReferenceCompletionOption[];
  readonly selectedIndex: number | null;
  readonly selectOptionAndCleanUp: (option: ReferenceCompletionOption) => void;
  readonly setHighlightedIndex: (index: number) => void;
}) {
  return (
    <EditorChromePanel className="cf-reference-completion-tooltip">
      <ul className="cf-reference-completion-list" role="listbox">
        {options.map((option, index) => {
          const selected = selectedIndex === index;
          return (
            <li
              aria-selected={selected}
              className={[
                "cf-reference-completion-preview",
                option.candidate.kind === "citation"
                  ? "cf-reference-completion-citation"
                  : "cf-reference-completion-crossref",
              ].join(" ")}
              id={`typeahead-item-${index}`}
              key={option.key}
              onMouseDown={(event) => {
                event.preventDefault();
                selectOptionAndCleanUp(option);
              }}
              onMouseEnter={() => setHighlightedIndex(index)}
              ref={option.setRefElement}
              role="option"
              tabIndex={-1}
            >
              <span className="cm-completionLabel">{option.candidate.label}</span>
              {option.candidate.detail ? (
                <span className="cm-completionDetail">{option.candidate.detail}</span>
              ) : null}
              <ReferenceCompletionPreview candidate={option.candidate} />
            </li>
          );
        })}
      </ul>
    </EditorChromePanel>
  );
}

export function ReferenceTypeaheadPlugin({
  insertionMode = "rich",
}: {
  readonly insertionMode?: "plain-text" | "rich";
}) {
  const context = useLexicalRenderContext();
  const [query, setQuery] = useState("");

  const triggerFn = useCallback((text: string, _editor: LexicalEditor): MenuTextMatch | null => {
    if (isForbiddenReferenceCompletionContext()) {
      return null;
    }
    return findReferenceCompletionMatch(text);
  }, []);

  const options = useMemo(() => filterReferenceCompletionCandidates(
    collectReferenceCompletionCandidates(context),
    query,
  ).map((candidate) => new ReferenceCompletionOption(candidate)), [context, query]);

  const menuRenderFn = useCallback<MenuRenderFn<ReferenceCompletionOption>>((anchorElementRef, itemProps) => {
    if (!anchorElementRef.current || itemProps.options.length === 0) {
      return null;
    }

    return createPortal(
      <ReferenceCompletionMenu
        options={itemProps.options}
        selectedIndex={itemProps.selectedIndex}
        selectOptionAndCleanUp={itemProps.selectOptionAndCleanUp}
        setHighlightedIndex={itemProps.setHighlightedIndex}
      />,
      anchorElementRef.current,
    );
  }, []);

  const onSelectOption = useCallback((
    option: ReferenceCompletionOption,
    textNodeContainingQuery: TextNode | null,
    closeMenu: () => void,
  ) => {
    $addUpdateTag(COFLAT_NESTED_EDIT_TAG);
    const raw = textNodeContainingQuery?.getTextContent() ?? "";

    const nextRaw = raw.startsWith("[")
      ? applyBracketedReferenceCompletion(raw, option.candidate.id)
      : `@${option.candidate.id}`;

    if (insertionMode === "plain-text") {
      if (textNodeContainingQuery) {
        textNodeContainingQuery.setTextContent(nextRaw);
        textNodeContainingQuery.selectEnd();
      } else {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          selection.insertText(nextRaw);
        }
      }
      closeMenu();
      return;
    }

    if (raw.startsWith("[")) {
      if (textNodeContainingQuery) {
        textNodeContainingQuery.setTextContent(nextRaw);
        textNodeContainingQuery.selectEnd();
      } else {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          selection.insertText(nextRaw);
        }
      }
      closeMenu();
      return;
    }

    const referenceNode = $createReferenceNode(`@${option.candidate.id}`);
    if (textNodeContainingQuery) {
      textNodeContainingQuery.replace(referenceNode);
      referenceNode.selectNext();
    } else {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        selection.insertNodes([referenceNode]);
      }
    }
    closeMenu();
  }, [insertionMode]);

  return (
    <LexicalTypeaheadMenuPlugin<ReferenceCompletionOption>
      anchorClassName="cf-reference-completion-anchor"
      menuRenderFn={menuRenderFn}
      onQueryChange={(nextQuery) => setQuery(nextQuery ?? "")}
      onSelectOption={onSelectOption}
      options={options}
      preselectFirstItem
      triggerFn={triggerFn}
    />
  );
}
