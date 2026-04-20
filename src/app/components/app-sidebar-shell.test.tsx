import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppSidebarShell } from "./app-sidebar-shell";
import { SidebarProvider } from "./sidebar";
import { AppEditorControllerProvider } from "../contexts/app-editor-context";
import { AppWorkspaceControllerProvider } from "../contexts/app-workspace-context";
import type { AppEditorShellController } from "../hooks/use-app-editor-shell";
import type { AppWorkspaceSessionController } from "../hooks/use-app-workspace-session";
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
      fileTree: null,
      loadChildren: async () => {},
    };
    const editor = {
      state: {
        currentPath: null,
        headings: [],
        diagnostics: [],
      },
      files: {
        openFile: async () => {},
        handleRename: async () => {},
        handleDelete: async () => {},
        createFile: async () => {},
        createDirectory: async () => {},
      },
      navigation: {
        handleOutlineSelect: vi.fn(),
      },
    };
    const sidebarLayout = {
      sidebarTab: "runtime" as const,
      setSidebarTab: vi.fn(),
    };

    act(() => {
      root.render(
        createElement(
          AppWorkspaceControllerProvider,
          {
            value: workspace as unknown as AppWorkspaceSessionController,
            children: createElement(
              AppEditorControllerProvider,
              {
                value: editor as unknown as AppEditorShellController,
                children: createElement(
                  SidebarProvider,
                  {
                    open: true,
                    onOpenChange: () => {},
                    width: 224,
                    onWidthChange: () => {},
                    children: createElement(AppSidebarShell, { sidebarLayout }),
                  },
                ),
              },
            ),
          },
        ),
      );
    });

    expect(container.textContent).toContain("Runtime");
    expect(container.textContent).toContain("No runtime errors yet");
  });
});
