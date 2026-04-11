import { $isCodeNode } from "@lexical/code";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  type MenuRenderFn,
  type MenuTextMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $getNodeByKey,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type TextNode,
} from "lexical";
import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { $createRawBlockNode, type RawBlockVariant } from "./nodes/raw-block-node";
import { $isTableCellNode } from "./nodes/table-cell-node";
import { $isTableNode } from "./nodes/table-node";
import { $isTableRowNode } from "./nodes/table-row-node";
import { createTableNodeFromMarkdown } from "./markdown";
import { EditorChromePanel } from "./editor-chrome";
import {
  getPendingEmbeddedSurfaceFocusId,
  queuePendingSurfaceFocus,
} from "./pending-surface-focus";
import { COFLAT_NESTED_EDIT_TAG } from "./update-tags";

type SlashInsertVariant = RawBlockVariant | "code-block" | "table";

interface SlashPickerEntry {
  readonly focusTarget: string;
  readonly keywords: readonly string[];
  readonly raw: string;
  readonly title: string;
  readonly variant: SlashInsertVariant;
}

const SLASH_PICKER_ENTRIES: readonly SlashPickerEntry[] = [
  {
    focusTarget: "table-cell",
    keywords: ["table", "grid", "columns", "rows"],
    raw: "| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |",
    title: "Table",
    variant: "table",
  },
  {
    focusTarget: "none",
    keywords: ["code", "block", "snippet", "fence"],
    raw: "```\n\n```",
    title: "Code block",
    variant: "code-block",
  },
  {
    focusTarget: "display-math",
    keywords: ["math", "display", "equation", "formula", "latex"],
    raw: "$$\n\n$$",
    title: "Display math",
    variant: "display-math",
  },
  {
    focusTarget: "footnote-body",
    keywords: ["footnote", "note", "annotation"],
    raw: "[^1]: ",
    title: "Footnote",
    variant: "footnote-definition",
  },
  {
    focusTarget: "include-path",
    keywords: ["include", "import", "file", "embed"],
    raw: ":::: {.include}\n\n::::",
    title: "Include",
    variant: "fenced-div",
  },
  {
    focusTarget: "block-body",
    keywords: ["theorem", "definition", "proof", "lemma", "block", "div"],
    raw: "::: {.theorem}\n\n:::",
    title: "Theorem / Definition",
    variant: "fenced-div",
  },
];

function isForbiddenSlashContext(): boolean {
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

function isStartOfParagraph(text: string, matchOffset: number): boolean {
  const before = text.slice(0, matchOffset);
  return before.length === 0 || /\s$/.test(before);
}

function findSlashMatch(text: string): MenuTextMatch | null {
  const match = text.match(/(^|\s)\/([\w\s]*)$/);
  if (!match) {
    return null;
  }

  const slashOffset = (match.index ?? 0) + match[1].length;
  if (!isStartOfParagraph(text, slashOffset)) {
    return null;
  }

  return {
    leadOffset: slashOffset,
    matchingString: match[2],
    replaceableString: match[0].trimStart(),
  };
}

class SlashPickerOption extends MenuOption {
  readonly entry: SlashPickerEntry;

  constructor(entry: SlashPickerEntry) {
    super(entry.title);
    this.entry = entry;
  }
}

function filterEntries(query: string): readonly SlashPickerOption[] {
  const q = query.toLowerCase().trim();
  if (q.length === 0) {
    return SLASH_PICKER_ENTRIES.map((e) => new SlashPickerOption(e));
  }
  return SLASH_PICKER_ENTRIES
    .filter((e) =>
      e.title.toLowerCase().includes(q)
      || e.keywords.some((kw) => kw.includes(q)),
    )
    .map((e) => new SlashPickerOption(e));
}

function SlashPickerMenu({
  options,
  selectedIndex,
  selectOptionAndCleanUp,
  setHighlightedIndex,
}: {
  readonly options: readonly SlashPickerOption[];
  readonly selectedIndex: number | null;
  readonly selectOptionAndCleanUp: (option: SlashPickerOption) => void;
  readonly setHighlightedIndex: (index: number) => void;
}) {
  return (
    <EditorChromePanel className="cf-slash-picker-tooltip">
      <ul className="cf-slash-picker-list" role="listbox">
        {options.map((option, index) => {
          const selected = selectedIndex === index;
          return (
            <li
              aria-selected={selected}
              className="cf-slash-picker-item"
              id={`slash-picker-item-${index}`}
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
              <span className="cf-slash-picker-label">{option.entry.title}</span>
            </li>
          );
        })}
      </ul>
    </EditorChromePanel>
  );
}

function ensureTrailingParagraph(insertedNode: LexicalNode): void {
  if (!insertedNode.getNextSibling()) {
    insertedNode.insertAfter($createParagraphNode());
  }
}

function focusFirstTableCell(editor: LexicalEditor, key: NodeKey): void {
  editor.update(() => {
    const node = $getNodeByKey(key);
    if (!$isTableNode(node)) {
      return;
    }

    const rowNodes = node.getChildren().filter($isTableRowNode);
    const targetRow = rowNodes[1] ?? rowNodes[0] ?? null;
    const targetCell = targetRow
      ?.getChildren()
      .find($isTableCellNode);

    if (!targetCell) {
      return;
    }

    const firstChild = targetCell.getFirstChild();
    if ($isElementNode(firstChild)) {
      firstChild.selectStart();
      return;
    }

    targetCell.selectStart();
  }, {
    discrete: true,
    tag: COFLAT_NESTED_EDIT_TAG,
  });
  editor.focus();
}

export function SlashPickerPlugin() {
  const [editor] = useLexicalComposerContext();

  const triggerFn = useCallback((text: string, _editor: LexicalEditor): MenuTextMatch | null => {
    if (isForbiddenSlashContext()) {
      return null;
    }
    return findSlashMatch(text);
  }, []);

  const [query, setQuery] = useState("");
  const options = useMemo(() => filterEntries(query), [query]);

  const menuRenderFn = useCallback<MenuRenderFn<SlashPickerOption>>((anchorElementRef, itemProps) => {
    if (!anchorElementRef.current || itemProps.options.length === 0) {
      return null;
    }

    return createPortal(
      <SlashPickerMenu
        options={itemProps.options}
        selectedIndex={itemProps.selectedIndex}
        selectOptionAndCleanUp={itemProps.selectOptionAndCleanUp}
        setHighlightedIndex={itemProps.setHighlightedIndex}
      />,
      anchorElementRef.current,
    );
  }, []);

  const onQueryChange = useCallback((nextQuery: string | null) => {
    setQuery(nextQuery ?? "");
  }, []);

  const onSelectOption = useCallback((
    option: SlashPickerOption,
    textNodeContainingQuery: TextNode | null,
    closeMenu: () => void,
  ) => {
    const { entry } = option;

    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) {
        closeMenu();
        return;
      }

      const anchorNode = selection.anchor.getNode();
      const paragraph = anchorNode.getTopLevelElement();
      if (!paragraph || paragraph.getType() !== "paragraph") {
        closeMenu();
        return;
      }

      if (entry.variant === "code-block") {
        // For code blocks, insert the raw markdown text and let
        // MarkdownShortcutPlugin handle the expansion.
        if (textNodeContainingQuery) {
          textNodeContainingQuery.setTextContent("```");
          textNodeContainingQuery.selectEnd();
        }
        closeMenu();
        return;
      }

      if (entry.variant === "table") {
        const tableNode = createTableNodeFromMarkdown(entry.raw);
        if (tableNode) {
          paragraph.replace(tableNode);
          ensureTrailingParagraph(tableNode);
          const tableKey = tableNode.getKey();
          requestAnimationFrame(() => {
            focusFirstTableCell(editor, tableKey);
          });
        }
        closeMenu();
        return;
      }

      // RawBlockNode variants: display-math, fenced-div, footnote-definition
      const variant = entry.variant as RawBlockVariant;
      const rawBlockNode = $createRawBlockNode(variant, entry.raw);
      const nodeKey = rawBlockNode.getKey();

      if (entry.focusTarget === "block-body" || entry.focusTarget === "footnote-body") {
        queuePendingSurfaceFocus(
          getPendingEmbeddedSurfaceFocusId(editor.getKey(), nodeKey, entry.focusTarget),
          "end",
        );
      }

      paragraph.replace(rawBlockNode);
      ensureTrailingParagraph(rawBlockNode);

      // Focus inserted block for display-math, include-path, frontmatter
      if (
        entry.focusTarget !== "block-body"
        && entry.focusTarget !== "footnote-body"
        && entry.focusTarget !== "none"
      ) {
        requestAnimationFrame(() => {
          const element = editor.getElementByKey(nodeKey);
          if (!element) {
            return;
          }

          const selector: Record<string, string> = {
            "display-math": ".cf-lexical-display-math-body",
            "include-path": ".cf-lexical-structure-toggle--include",
          };
          const sel = selector[entry.focusTarget];
          if (!sel) {
            return;
          }
          const target = element.querySelector<HTMLElement>(sel);
          if (target) {
            target.focus();
            target.click();
          }
        });
      }
    }, { discrete: true, tag: COFLAT_NESTED_EDIT_TAG });

    closeMenu();
  }, [editor]);

  return (
    <LexicalTypeaheadMenuPlugin<SlashPickerOption>
      anchorClassName="cf-slash-picker-anchor"
      menuRenderFn={menuRenderFn}
      onQueryChange={onQueryChange}
      onSelectOption={onSelectOption}
      options={options}
      preselectFirstItem
      triggerFn={triggerFn}
    />
  );
}
