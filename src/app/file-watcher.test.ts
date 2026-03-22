import { describe, expect, it, vi } from "vitest";

import { FileWatcher } from "./file-watcher";

function createWatcher(reloadFile = vi.fn(async () => {})) {
  const container = document.createElement("div");
  const watcher = new FileWatcher({
    isFileOpen: () => true,
    isFileDirty: () => true,
    reloadFile,
    container,
  });

  return { container, watcher, reloadFile };
}

describe("FileWatcher", () => {
  it("queues dirty-file notifications instead of dropping earlier ones", () => {
    const { container, watcher } = createWatcher();
    const handleFileChanged = (watcher as unknown as { handleFileChanged: (path: string) => void })
      .handleFileChanged
      .bind(watcher as unknown as { handleFileChanged: (path: string) => void });

    handleFileChanged("a.md");
    handleFileChanged("b.md");

    expect(container.textContent).toContain("\"a.md\" changed externally. Reload?");

    const noButton = container.querySelector<HTMLButtonElement>(".file-watcher-btn-no");
    expect(noButton).not.toBeNull();
    noButton?.click();

    expect(container.textContent).toContain("\"b.md\" changed externally. Reload?");
  });

  it("suppresses duplicate notifications while a file is already pending", () => {
    const { container, watcher } = createWatcher();
    const handleFileChanged = (watcher as unknown as { handleFileChanged: (path: string) => void })
      .handleFileChanged
      .bind(watcher as unknown as { handleFileChanged: (path: string) => void });

    handleFileChanged("a.md");
    handleFileChanged("a.md");

    expect(container.querySelectorAll(".file-watcher-notification")).toHaveLength(1);
    expect(container.textContent?.match(/a\.md/g)?.length).toBe(1);
  });

  it("reloads the current file and advances to the next pending notification", async () => {
    const reloadFile = vi.fn(async () => {});
    const { container, watcher } = createWatcher(reloadFile);
    const handleFileChanged = (watcher as unknown as { handleFileChanged: (path: string) => void })
      .handleFileChanged
      .bind(watcher as unknown as { handleFileChanged: (path: string) => void });

    handleFileChanged("a.md");
    handleFileChanged("b.md");

    const yesButton = container.querySelector<HTMLButtonElement>(".file-watcher-btn-yes");
    expect(yesButton).not.toBeNull();
    yesButton?.click();
    await Promise.resolve();

    expect(reloadFile).toHaveBeenCalledWith("a.md");
    expect(container.textContent).toContain("\"b.md\" changed externally. Reload?");
  });
});
