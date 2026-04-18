import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  type MenuRenderFn,
  type MenuTextMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
  type TextNode,
} from "lexical";
import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import {
  activateInsertedBlock,
  ensureTrailingParagraph,
} from "./block-insert-focus";
import { SLASH_INSERT_SPECS, type SlashInsertSpec } from "./block-insert-catalog";
import {
  createInsertBlockNode,
} from "./block-insert-node";
import { EditorChromePanel } from "./editor-chrome";
import { $isForbiddenTypeaheadContext } from "./typeahead-context";
import { COFLAT_NESTED_EDIT_TAG } from "./update-tags";

function findSlashMatch(text: string): MenuTextMatch | null {
  const match = text.match(/(^|\s)\/([\w\s]*)$/);
  if (!match) {
    return null;
  }

  const slashOffset = (match.index ?? 0) + match[1].length;
  return {
    leadOffset: slashOffset,
    matchingString: match[2],
    replaceableString: match[0].trimStart(),
  };
}

class SlashPickerOption extends MenuOption {
  readonly entry: SlashInsertSpec;

  constructor(entry: SlashInsertSpec) {
    super(entry.title);
    this.entry = entry;
  }
}

const ALL_OPTIONS = SLASH_INSERT_SPECS.map((e) => new SlashPickerOption(e));

function filterEntries(query: string): SlashPickerOption[] {
  const q = query.toLowerCase().trim();
  if (q.length === 0) {
    return ALL_OPTIONS;
  }
  return ALL_OPTIONS.filter((o) =>
    o.entry.title.toLowerCase().includes(q)
    || o.entry.keywords.some((kw) => kw.includes(q)),
  );
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

export function SlashPickerPlugin() {
  const [editor] = useLexicalComposerContext();

  const triggerFn = useCallback((text: string, _editor: LexicalEditor): MenuTextMatch | null => {
    if ($isForbiddenTypeaheadContext()) {
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
        return;
      }

      const anchorNode = selection.anchor.getNode();
      const paragraph = anchorNode.getTopLevelElement();
      if (!paragraph || paragraph.getType() !== "paragraph") {
        return;
      }

      if (entry.variant === "code-block") {
        if (textNodeContainingQuery) {
          textNodeContainingQuery.setTextContent("```");
          textNodeContainingQuery.selectEnd();
        }
        return;
      }

      const blockNode = createInsertBlockNode(entry.variant, entry.raw);
      if (!blockNode) {
        return;
      }
      const nodeKey = blockNode.getKey();

      paragraph.replace(blockNode);
      ensureTrailingParagraph(blockNode);
      activateInsertedBlock(editor, nodeKey, entry.focusTarget);
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
