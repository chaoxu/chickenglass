import { describe, expect, it } from "vitest";
import { createHeadlessEditor } from "@lexical/headless";
import { $createListItemNode, $createListNode, ListItemNode, ListNode } from "@lexical/list";
import { $getNodeByKey, $getRoot, ParagraphNode, TextNode, type LexicalEditor } from "lexical";

import { $handleTabKeyCommand } from "./tab-key-plugin";

function createTabTestEditor(): LexicalEditor {
  return createHeadlessEditor({
    namespace: "coflat-tab-key-plugin-test",
    nodes: [ParagraphNode, TextNode, ListNode, ListItemNode],
    onError(error) {
      throw error;
    },
  });
}

function readIndentByKey(editor: LexicalEditor, key: string): number {
  let indent = -1;
  editor.getEditorState().read(() => {
    const node = $getNodeByKey(key);
    if (!(node instanceof ListItemNode)) {
      throw new Error("expected list item node");
    }
    indent = node.getIndent();
  });
  return indent;
}

describe("tab key plugin", () => {
  it("increases list-item indent on Tab", () => {
    const editor = createTabTestEditor();
    const event = new KeyboardEvent("keydown", { cancelable: true, key: "Tab" });
    let itemKey = "";

    editor.update(() => {
      const list = $createListNode("bullet");
      const leading = $createListItemNode();
      leading.append(new TextNode("first"));
      const item = $createListItemNode();
      item.append(new TextNode("second"));
      itemKey = item.getKey();
      list.append(leading, item);
      $getRoot().append(list);
      item.selectEnd();
      $handleTabKeyCommand(event);
    }, { discrete: true });

    expect(readIndentByKey(editor, itemKey)).toBe(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("decreases list-item indent on Shift+Tab", () => {
    const editor = createTabTestEditor();
    const event = new KeyboardEvent("keydown", { cancelable: true, key: "Tab", shiftKey: true });
    let itemKey = "";

    editor.update(() => {
      const list = $createListNode("bullet");
      const leading = $createListItemNode();
      leading.append(new TextNode("first"));
      const item = $createListItemNode();
      item.append(new TextNode("second"));
      itemKey = item.getKey();
      list.append(leading, item);
      $getRoot().append(list);
      item.setIndent(2);
      item.selectEnd();
      $handleTabKeyCommand(event);
    }, { discrete: true });

    expect(readIndentByKey(editor, itemKey)).toBe(1);
  });

  it("clamps Shift+Tab at zero indent", () => {
    const editor = createTabTestEditor();
    const event = new KeyboardEvent("keydown", { cancelable: true, key: "Tab", shiftKey: true });
    let itemKey = "";

    editor.update(() => {
      const list = $createListNode("bullet");
      const item = $createListItemNode();
      item.append(new TextNode("hello"));
      itemKey = item.getKey();
      list.append(item);
      $getRoot().append(list);
      item.selectEnd();
      $handleTabKeyCommand(event);
    }, { discrete: true });

    expect(readIndentByKey(editor, itemKey)).toBe(0);
  });

  it("prevents default for Tab outside a list so focus does not leak", () => {
    const editor = createTabTestEditor();
    const event = new KeyboardEvent("keydown", { cancelable: true, key: "Tab" });
    let handled = false;

    editor.update(() => {
      const paragraph = new ParagraphNode();
      paragraph.append(new TextNode("plain"));
      $getRoot().append(paragraph);
      paragraph.selectEnd();
      handled = $handleTabKeyCommand(event);
    }, { discrete: true });

    expect(handled).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });
});
