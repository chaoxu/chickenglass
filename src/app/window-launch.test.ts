import { describe, expect, it, vi } from "vitest";

const createdWindows: Array<{ label: string; options: { title: string; url: string } }> = [];

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class MockWebviewWindow {
    constructor(label: string, options: { title: string; url: string }) {
      createdWindows.push({ label, options });
    }

    once(event: string, callback: () => void): void {
      if (event === "tauri://created") {
        setTimeout(callback, 0);
      }
    }
  },
}));

describe("openDocumentInNewWindow", () => {
  it("passes the target project root and document as one-shot launch params", async () => {
    createdWindows.length = 0;
    window.history.replaceState({}, "", "/?keep=1");

    const { openDocumentInNewWindow } = await import("./window-launch");

    await openDocumentInNewWindow("/tmp/coflat-native-project-b", "outside.md");

    expect(createdWindows).toHaveLength(1);
    expect(createdWindows[0].options.title).toBe("Coflat — outside.md");
    expect(createdWindows[0].options.url).toBe(
      `${window.location.origin}/?keep=1&projectRoot=%2Ftmp%2Fcoflat-native-project-b&file=outside.md`,
    );
  });
});
