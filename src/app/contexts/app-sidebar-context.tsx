import { createContext, useContext } from "react";
import type { DiagnosticEntry } from "../diagnostics";
import type { FileEntry } from "../file-manager";
import type { HeadingEntry } from "../heading-ancestry";

/** File-tree sidebar reads only project tree and file mutation commands. */
export interface AppSidebarFileTreeController {
  readonly activePath: string | null;
  readonly createDirectory: (path: string) => Promise<void>;
  readonly createFile: (path: string) => Promise<void>;
  readonly fileTree: FileEntry | null;
  readonly handleDelete: (path: string) => Promise<void>;
  readonly handleRename: (oldPath: string, newPath: string) => Promise<void>;
  readonly loadChildren: (dirPath: string) => Promise<void>;
  readonly openFile: (path: string) => Promise<void>;
}

/** Outline sidebar reads editor-derived headings without subscribing files chrome. */
export interface AppSidebarOutlineController {
  readonly headings: HeadingEntry[];
  readonly onSelect: (from: number) => void;
}

/** Diagnostics sidebar reads diagnostics independently from files/outline chrome. */
export interface AppSidebarDiagnosticsController {
  readonly diagnostics: DiagnosticEntry[];
  readonly onSelect: (from: number) => void;
}

const AppSidebarFileTreeContext =
  createContext<AppSidebarFileTreeController | null>(null);
const AppSidebarOutlineContext =
  createContext<AppSidebarOutlineController | null>(null);
const AppSidebarDiagnosticsContext =
  createContext<AppSidebarDiagnosticsController | null>(null);

export const AppSidebarFileTreeProvider = AppSidebarFileTreeContext.Provider;
export const AppSidebarOutlineProvider = AppSidebarOutlineContext.Provider;
export const AppSidebarDiagnosticsProvider = AppSidebarDiagnosticsContext.Provider;

export function useAppSidebarFileTree(): AppSidebarFileTreeController {
  const controller = useContext(AppSidebarFileTreeContext);
  if (!controller) {
    throw new Error(
      "useAppSidebarFileTree must be used within an AppSidebarFileTreeProvider",
    );
  }
  return controller;
}

export function useAppSidebarOutline(): AppSidebarOutlineController {
  const controller = useContext(AppSidebarOutlineContext);
  if (!controller) {
    throw new Error(
      "useAppSidebarOutline must be used within an AppSidebarOutlineProvider",
    );
  }
  return controller;
}

export function useAppSidebarDiagnostics(): AppSidebarDiagnosticsController {
  const controller = useContext(AppSidebarDiagnosticsContext);
  if (!controller) {
    throw new Error(
      "useAppSidebarDiagnostics must be used within an AppSidebarDiagnosticsProvider",
    );
  }
  return controller;
}
