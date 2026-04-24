import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppSidebarShell } from "./app-sidebar-shell";
import { SidebarProvider } from "./sidebar";
import {
  AppSidebarDiagnosticsProvider,
  AppSidebarFileTreeProvider,
  AppSidebarOutlineProvider,
} from "../contexts/app-sidebar-context";
import { clearRuntimeLogs } from "../runtime-logger";

const sidebarShellTestState = vi.hoisted(() => ({
  fileTreeRenderCount: 0,
}));

vi.mock("./file-tree", () => ({
  FileTree: () => {
    sidebarShellTestState.fileTreeRenderCount += 1;
    return null;
  },
}));

describe("AppSidebarShell", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    clearRuntimeLogs();
    sidebarShellTestState.fileTreeRenderCount = 0;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    clearRuntimeLogs();
  });

  it("shows the runtime tab and empty-state panel in test mode", () => {
    const fileTree = {
      fileTree: null,
      activePath: null,
      openFile: async () => {},
      handleRename: async () => {},
      handleDelete: async () => {},
      createFile: async () => {},
      createDirectory: async () => {},
      loadChildren: async () => {},
    };
    const outline = {
      headings: [],
      onSelect: vi.fn(),
    };
    const diagnostics = {
      diagnostics: [],
      onSelect: vi.fn(),
    };
    const sidebarLayout = {
      sidebarTab: "runtime" as const,
      setSidebarTab: vi.fn(),
    };

    act(() => {
      root.render(renderSidebar({
        children: createElement(AppSidebarShell, { sidebarLayout }),
        diagnostics,
        fileTree,
        outline,
      }));
    });

    expect(container.textContent).toContain("Logs");
    expect(container.textContent).toContain("No runtime errors yet");
  });

  it("does not rerender file-tree chrome when editor text-only state changes", async () => {
    const fileTree = {
      activePath: "draft.md",
      createDirectory: vi.fn(async () => {}),
      createFile: vi.fn(async () => {}),
      fileTree: {
        name: "project",
        path: "",
        isDirectory: true,
        children: [{ name: "draft.md", path: "draft.md", isDirectory: false }],
      },
      handleDelete: vi.fn(async () => {}),
      handleRename: vi.fn(async () => {}),
      loadChildren: vi.fn(async () => {}),
      openFile: vi.fn(async () => {}),
    };
    const outline = {
      headings: [],
      onSelect: vi.fn(),
    };
    const diagnostics = {
      diagnostics: [],
      onSelect: vi.fn(),
    };
    const sidebarLayout = {
      sidebarTab: "files" as const,
      setSidebarTab: vi.fn(),
    };
    act(() => {
      root.render(renderSidebar({
        children: createElement(AppSidebarShell, { sidebarLayout }),
        diagnostics,
        fileTree,
        outline,
      }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(sidebarShellTestState.fileTreeRenderCount).toBe(1);

    act(() => {
      root.render(renderSidebar({
        children: createElement(AppSidebarShell, { sidebarLayout }),
        diagnostics,
        fileTree,
        outline,
      }));
    });

    expect(sidebarShellTestState.fileTreeRenderCount).toBe(1);
  });
});

function renderSidebar({
  children,
  diagnostics,
  fileTree,
  outline,
}: {
  readonly children: ReactNode;
  readonly diagnostics: ComponentProps<typeof AppSidebarDiagnosticsProvider>["value"];
  readonly fileTree: ComponentProps<typeof AppSidebarFileTreeProvider>["value"];
  readonly outline: ComponentProps<typeof AppSidebarOutlineProvider>["value"];
}) {
  return createElement(
    AppSidebarFileTreeProvider,
    {
      value: fileTree,
      children: createElement(
        AppSidebarOutlineProvider,
        {
          value: outline,
          children: createElement(
            AppSidebarDiagnosticsProvider,
            {
              value: diagnostics,
              children: createElement(
                SidebarProvider,
                {
                  open: true,
                  onOpenChange: () => {},
                  width: 224,
                  onWidthChange: () => {},
                  children,
                },
              ),
            },
          ),
        },
      ),
    },
  );
}
