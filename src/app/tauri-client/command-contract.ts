import type { PerfSnapshot } from "../../lib/perf";
import type {
  ConditionalWriteResult,
  FileEntry,
} from "../../lib/types";
import type { ExportFormat } from "../lib/types";

export type TauriCommandDefinition<
  Name extends string = string,
  Args extends readonly string[] = readonly string[],
> = {
  readonly name: Name;
  readonly args: Args;
};

export type TauriCommandGroupContract = Readonly<
  Record<string, TauriCommandDefinition>
>;

export const TAURI_COMMAND_CONTRACT = {
  fs: {
    openFolder: { name: "open_folder", args: ["path", "generation"] },
    readFile: { name: "read_file", args: ["path"] },
    writeFile: { name: "write_file", args: ["path", "content"] },
    writeFileIfHash: {
      name: "write_file_if_hash",
      args: ["path", "content", "expectedHash"],
    },
    createFile: { name: "create_file", args: ["path", "content"] },
    createDirectory: { name: "create_directory", args: ["path"] },
    fileExists: { name: "file_exists", args: ["path"] },
    renameFile: { name: "rename_file", args: ["oldPath", "newPath"] },
    listTree: { name: "list_tree", args: [] },
    listChildren: { name: "list_children", args: ["path"] },
    deleteFile: { name: "delete_file", args: ["path"] },
    writeFileBinary: { name: "write_file_binary", args: ["path", "dataBase64"] },
    readFileBinary: { name: "read_file_binary", args: ["path"] },
  },
  watch: {
    watchDirectory: {
      name: "watch_directory",
      args: ["generation", "debounceMs"],
    },
    unwatchDirectory: { name: "unwatch_directory", args: ["generation"] },
  },
  export: {
    checkPandoc: { name: "check_pandoc", args: ["format"] },
    exportDocument: {
      name: "export_document",
      args: [
        "content",
        "format",
        "outputPath",
        "sourcePath",
        "template",
        "bibliography",
      ],
    },
  },
  path: {
    toProjectRelativePath: {
      name: "to_project_relative_path",
      args: ["path"],
    },
    canonicalizeProjectRoot: {
      name: "canonicalize_project_root",
      args: ["path"],
    },
    resolveProjectFileTarget: {
      name: "resolve_project_file_target",
      args: ["path"],
    },
  },
  shell: {
    openUrl: { name: "open_url", args: ["url"] },
    revealInFinder: { name: "reveal_in_finder", args: ["path"] },
  },
  perf: {
    getPerfSnapshot: { name: "get_perf_snapshot", args: [] },
    clearPerfSnapshot: { name: "clear_perf_snapshot", args: [] },
  },
  recovery: {
    writeHotExitBackup: {
      name: "write_hot_exit_backup",
      args: ["projectRoot", "path", "name", "content", "baselineHash"],
    },
    listHotExitBackups: {
      name: "list_hot_exit_backups",
      args: ["projectRoot"],
    },
    readHotExitBackup: {
      name: "read_hot_exit_backup",
      args: ["projectRoot", "path"],
    },
    deleteHotExitBackup: {
      name: "delete_hot_exit_backup",
      args: ["projectRoot", "path"],
    },
  },
  debug: {
    debugListWindows: { name: "debug_list_windows", args: [] },
    debugGetNativeState: { name: "debug_get_native_state", args: [] },
    debugEmitFileChanged: {
      name: "debug_emit_file_changed",
      args: ["relativePath", "treeChanged"],
    },
  },
} as const satisfies Record<string, TauriCommandGroupContract>;

export interface WatchDirectoryResult {
  readonly applied: boolean;
  readonly root: string;
}

export interface OpenFolderResult {
  readonly applied: boolean;
  readonly root: string;
}

export interface ProjectFileTarget {
  readonly projectRoot: string;
  readonly relativePath: string;
}

export interface NativeWindowDebugInfo {
  readonly label: string;
  readonly focused: boolean;
}

export interface NativeDebugState {
  readonly project_root: string | null;
  readonly project_generation: number | null;
  readonly watcher_root: string | null;
  readonly watcher_generation: number | null;
  readonly watcher_active: boolean;
  readonly last_focused_window: string | null;
}

export interface HotExitBackup {
  readonly version: 1;
  readonly id: string;
  readonly projectRoot: string;
  readonly projectKey: string;
  readonly path: string;
  readonly name: string;
  readonly content: string;
  readonly contentHash: string;
  readonly baselineHash?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface HotExitBackupSummary {
  readonly id: string;
  readonly projectRoot: string;
  readonly projectKey: string;
  readonly path: string;
  readonly name: string;
  readonly contentHash: string;
  readonly baselineHash?: string;
  readonly updatedAt: number;
  readonly bytes: number;
}

export interface ExportToolStatus {
  readonly name: string;
  readonly available: boolean;
  readonly version?: string;
  readonly install_hint: string;
  readonly message?: string;
}

export interface ExportDependencyCheck {
  readonly format: ExportFormat;
  readonly ok: boolean;
  readonly tools: readonly ExportToolStatus[];
}

export interface TauriCommandTypes {
  readonly open_folder: {
    readonly args: { readonly path: string; readonly generation: number };
    readonly result: OpenFolderResult;
  };
  readonly read_file: {
    readonly args: { readonly path: string };
    readonly result: string;
  };
  readonly write_file: {
    readonly args: { readonly path: string; readonly content: string };
    readonly result: undefined;
  };
  readonly write_file_if_hash: {
    readonly args: {
      readonly path: string;
      readonly content: string;
      readonly expectedHash: string;
    };
    readonly result: ConditionalWriteResult;
  };
  readonly create_file: {
    readonly args: { readonly path: string; readonly content: string };
    readonly result: undefined;
  };
  readonly create_directory: {
    readonly args: { readonly path: string };
    readonly result: undefined;
  };
  readonly file_exists: {
    readonly args: { readonly path: string };
    readonly result: boolean;
  };
  readonly rename_file: {
    readonly args: { readonly oldPath: string; readonly newPath: string };
    readonly result: undefined;
  };
  readonly list_tree: {
    readonly args: undefined;
    readonly result: FileEntry;
  };
  readonly list_children: {
    readonly args: { readonly path: string };
    readonly result: FileEntry[];
  };
  readonly delete_file: {
    readonly args: { readonly path: string };
    readonly result: undefined;
  };
  readonly write_file_binary: {
    readonly args: { readonly path: string; readonly dataBase64: string };
    readonly result: undefined;
  };
  readonly read_file_binary: {
    readonly args: { readonly path: string };
    readonly result: string;
  };
  readonly watch_directory: {
    readonly args: {
      readonly generation: number;
      readonly debounceMs: number;
    };
    readonly result: WatchDirectoryResult;
  };
  readonly unwatch_directory: {
    readonly args: { readonly generation: number };
    readonly result: boolean;
  };
  readonly check_pandoc: {
    readonly args: { readonly format: ExportFormat };
    readonly result: ExportDependencyCheck;
  };
  readonly export_document: {
    readonly args: {
      readonly content: string;
      readonly format: ExportFormat;
      readonly outputPath: string;
      readonly sourcePath: string;
      readonly template?: string;
      readonly bibliography?: string;
    };
    readonly result: string;
  };
  readonly to_project_relative_path: {
    readonly args: { readonly path: string };
    readonly result: string;
  };
  readonly canonicalize_project_root: {
    readonly args: { readonly path: string };
    readonly result: string;
  };
  readonly resolve_project_file_target: {
    readonly args: { readonly path: string };
    readonly result: ProjectFileTarget;
  };
  readonly open_url: {
    readonly args: { readonly url: string };
    readonly result: undefined;
  };
  readonly reveal_in_finder: {
    readonly args: { readonly path: string };
    readonly result: undefined;
  };
  readonly get_perf_snapshot: {
    readonly args: undefined;
    readonly result: PerfSnapshot;
  };
  readonly clear_perf_snapshot: {
    readonly args: undefined;
    readonly result: undefined;
  };
  readonly write_hot_exit_backup: {
    readonly args: {
      readonly projectRoot: string;
      readonly path: string;
      readonly name: string;
      readonly content: string;
      readonly baselineHash?: string;
    };
    readonly result: HotExitBackupSummary;
  };
  readonly list_hot_exit_backups: {
    readonly args: { readonly projectRoot: string };
    readonly result: HotExitBackupSummary[];
  };
  readonly read_hot_exit_backup: {
    readonly args: { readonly projectRoot: string; readonly path: string };
    readonly result: HotExitBackup | null;
  };
  readonly delete_hot_exit_backup: {
    readonly args: { readonly projectRoot: string; readonly path: string };
    readonly result: undefined;
  };
  readonly debug_list_windows: {
    readonly args: undefined;
    readonly result: NativeWindowDebugInfo[];
  };
  readonly debug_get_native_state: {
    readonly args: undefined;
    readonly result: NativeDebugState;
  };
  readonly debug_emit_file_changed: {
    readonly args: {
      readonly relativePath: string;
      readonly treeChanged?: boolean;
    };
    readonly result: undefined;
  };
}

type TauriContractGroup = typeof TAURI_COMMAND_CONTRACT;
type TauriContractCommandDefinition = {
  readonly [Group in keyof TauriContractGroup]: TauriContractGroup[Group][keyof TauriContractGroup[Group]];
}[keyof TauriContractGroup];
type TauriContractCommandName = TauriContractCommandDefinition["name"];
type AssertNever<T extends never> = T;

export type TauriCommandContractCoversTypes = AssertNever<
  Exclude<TauriContractCommandName, keyof TauriCommandTypes>
>;
export type TauriCommandTypesCoverContract = AssertNever<
  Exclude<keyof TauriCommandTypes, TauriContractCommandName>
>;

export type TauriCommandName = TauriContractCommandName & keyof TauriCommandTypes;
export type TauriCommandArgs<Name extends TauriCommandName> =
  TauriCommandTypes[Name]["args"];
export type TauriCommandResult<Name extends TauriCommandName> =
  TauriCommandTypes[Name]["result"];
export type TauriCommandDefinitionFor<Name extends TauriCommandName> = Extract<
  TauriContractCommandDefinition,
  { readonly name: Name }
>;

type TauriCommandTypeArgKeys<Name extends TauriCommandName> =
  TauriCommandTypes[Name]["args"] extends undefined
    ? never
    : keyof TauriCommandTypes[Name]["args"] & string;
type TauriContractArgKeys<Name extends TauriCommandName> =
  TauriCommandDefinitionFor<Name>["args"][number];
export type TauriCommandArgKeysCoverContract = AssertNever<{
  readonly [Name in TauriCommandName]: Exclude<
    TauriCommandTypeArgKeys<Name>,
    TauriContractArgKeys<Name>
  >;
}[TauriCommandName]>;
export type TauriCommandContractArgKeysCoverTypes = AssertNever<{
  readonly [Name in TauriCommandName]: Exclude<
    TauriContractArgKeys<Name>,
    TauriCommandTypeArgKeys<Name>
  >;
}[TauriCommandName]>;

export type TauriNoArgCommandName = {
  readonly [Name in TauriCommandName]: TauriCommandArgs<Name> extends undefined
    ? Name
    : never;
}[TauriCommandName];
export type TauriArgsCommandName = Exclude<
  TauriCommandName,
  TauriNoArgCommandName
>;
