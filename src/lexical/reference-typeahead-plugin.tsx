import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  type MenuRenderFn,
  type MenuTextMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import {
  $addUpdateTag,
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
  type LexicalNode,
  type TextNode,
} from "lexical";
import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import {
  applyBracketedReferenceCompletion,
  collectReferenceCompletionCandidates,
  filterReferenceCompletionCandidates,
  findReferenceCompletionMatch,
  type ReferenceCompletionCandidate,
} from "../state/reference-completion-engine";
import { EditorChromePanel } from "./editor-chrome";
import { $createReferenceNode } from "./nodes/reference-node";
import {
  buildReferenceCompletionPreviewModel,
  ReferenceCompletionPreview,
  type ReferenceCompletionPreviewModel,
} from "./reference-completion-preview";
import { useLexicalRenderContext } from "./render-context";
import { $isForbiddenTypeaheadContext } from "./typeahead-context";
import { COFLAT_NESTED_EDIT_TAG } from "./update-tags";

class ReferenceCompletionOption extends MenuOption {
  readonly candidate: ReferenceCompletionCandidate;
  readonly preview: ReferenceCompletionPreviewModel | null;

  constructor(
    candidate: ReferenceCompletionCandidate,
    preview: ReferenceCompletionPreviewModel | null,
  ) {
    super(candidate.id);
    this.candidate = candidate;
    this.preview = preview;
  }
}

function $selectAfterInlineCompletion(node: LexicalNode): void {
  const nextSibling = node.getNextSibling();
  if (nextSibling) {
    node.selectNext();
    return;
  }

  const caretNode = $createTextNode(" ");
  node.insertAfter(caretNode);
  caretNode.selectEnd();
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
      <ul
        aria-activedescendant={selectedIndex === null ? undefined : `typeahead-item-${selectedIndex}`}
        className="cf-reference-completion-list"
        role="listbox"
      >
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
              <ReferenceCompletionPreview preview={option.preview} />
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
  const completionDependencies = useMemo(() => ({
    citations: context.citations,
    labelGraph: context.labelGraph,
    renderIndex: context.renderIndex,
  }), [context.citations, context.labelGraph, context.renderIndex]);
  const previewRenderOptions = useMemo(() => ({
    citations: context.citations,
    config: context.config,
    docPath: context.docPath,
    renderIndex: context.renderIndex,
    resolveAssetUrl: context.resolveAssetUrl,
  }), [
    context.citations,
    context.config,
    context.docPath,
    context.renderIndex,
    context.resolveAssetUrl,
  ]);
  const candidates = useMemo(
    () => collectReferenceCompletionCandidates(completionDependencies),
    [completionDependencies],
  );

  const triggerFn = useCallback((text: string, _editor: LexicalEditor): MenuTextMatch | null => {
    if ($isForbiddenTypeaheadContext()) {
      return null;
    }
    return findReferenceCompletionMatch(text);
  }, []);

  const options = useMemo(
    () => filterReferenceCompletionCandidates(candidates, query).map((candidate) =>
      new ReferenceCompletionOption(
        candidate,
        buildReferenceCompletionPreviewModel(candidate, previewRenderOptions),
      )),
    [candidates, previewRenderOptions, query],
  );

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
      const referenceNode = $createReferenceNode(nextRaw);
      if (textNodeContainingQuery) {
        textNodeContainingQuery.replace(referenceNode);
        $selectAfterInlineCompletion(referenceNode);
      } else {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          selection.insertNodes([referenceNode]);
          $selectAfterInlineCompletion(referenceNode);
        }
      }
      closeMenu();
      return;
    }

    const referenceNode = $createReferenceNode(`@${option.candidate.id}`);
    if (textNodeContainingQuery) {
      textNodeContainingQuery.replace(referenceNode);
      $selectAfterInlineCompletion(referenceNode);
    } else {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        selection.insertNodes([referenceNode]);
        $selectAfterInlineCompletion(referenceNode);
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
