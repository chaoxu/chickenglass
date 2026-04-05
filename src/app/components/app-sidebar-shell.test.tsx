import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppSidebarShell } from "./app-sidebar-shell";
import { SidebarProvider } from "./sidebar";
import { clearRuntimeLogs } from "../runtime-logger";

describe("AppSidebarShell", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    clearRuntimeLogs();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    clearRuntimeLogs();
  });

  it("shows the runtime tab and empty-state panel in test mode", () => {
    const workspace = {
      sidebarTab: "runtime" as const,
      setSidebarTab: vi.fn(),
      fileTree: null,
      loadChildren: async () => {},
    };
    const editor = {
      currentPath: null,
      openFile: async () => {},
      handleRename: async () => {},
      handleDelete: async () => {},
      createFile: async () => {},
      createDirectory: async () => {},
      headings: [],
      diagnostics: [],
      handleOutlineSelect: vi.fn(),
      editorState: null,
    };

    act(() => {
      root.render(
        createElement(
          SidebarProvider,
          {
            open: true,
            onOpenChange: () => {},
            width: 224,
            onWidthChange: () => {},
            children: createElement(AppSidebarShell, { workspace, editor }),
          },
        ),
      );
    });

    expect(container.textContent).toContain("Runtime");
    expect(container.textContent).toContain("No runtime errors yet");
  });
});
