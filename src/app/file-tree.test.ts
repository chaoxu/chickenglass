import { describe, expect, it, vi } from "vitest";

import type { FileEntry } from "./file-manager";
import { FileTree } from "./file-tree";

function makeTree(): FileEntry {
  return {
    name: "project",
    path: "",
    isDirectory: true,
    children: [
      {
        name: "chapters",
        path: "chapters",
        isDirectory: true,
        children: [
          { name: "intro.md", path: "chapters/intro.md", isDirectory: false },
        ],
      },
      { name: "main.md", path: "main.md", isDirectory: false },
    ],
  };
}

describe("FileTree", () => {
  it("creates an element", () => {
    const tree = new FileTree();
    expect(tree.element).toBeInstanceOf(HTMLElement);
    expect(tree.element.className).toBe("file-tree");
  });

  it("renders file entries", () => {
    const tree = new FileTree();
    tree.render(makeTree());

    const items = tree.element.querySelectorAll(".file-tree-item");
    expect(items.length).toBeGreaterThanOrEqual(2);
  });

  it("renders directory and file labels", () => {
    const tree = new FileTree();
    tree.render(makeTree());

    const labels = tree.element.querySelectorAll(".file-tree-label");
    const names = [...labels].map((el) => el.textContent);
    expect(names).toContain("chapters");
    expect(names).toContain("main.md");
  });

  it("calls select handler on file click", () => {
    const tree = new FileTree();
    const handler = vi.fn();
    tree.setSelectHandler(handler);
    tree.render(makeTree());

    // Find the main.md item and click it
    const items = tree.element.querySelectorAll(".file-tree-item");
    const mainItem = [...items].find(
      (el) => (el as HTMLElement).dataset.path === "main.md",
    );
    (mainItem as HTMLElement)?.click();
    expect(handler).toHaveBeenCalledWith("main.md");
  });

  it("sets active path and highlights it", () => {
    const tree = new FileTree();
    tree.setActivePath("main.md");
    tree.render(makeTree());

    const active = tree.element.querySelector(".file-tree-active");
    expect(active).not.toBeNull();
    expect((active as HTMLElement).dataset.path).toBe("main.md");
  });

  it("toggles directory children on click", () => {
    const tree = new FileTree();
    tree.render(makeTree());

    // Find directory and its children container
    const dirItem = tree.element.querySelector(".file-tree-directory");
    expect(dirItem).not.toBeNull();

    const childContainer = dirItem?.parentElement?.querySelector(
      ".file-tree-children",
    );
    expect(childContainer).not.toBeNull();
    expect((childContainer as HTMLElement).style.display).toBe("none");

    // Click to expand
    (dirItem as HTMLElement).click();
    expect((childContainer as HTMLElement).style.display).toBe("block");

    // Click to collapse
    (dirItem as HTMLElement).click();
    expect((childContainer as HTMLElement).style.display).toBe("none");
  });
});
