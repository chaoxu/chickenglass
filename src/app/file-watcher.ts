/**
 * File watcher for detecting external changes in Tauri mode.
 *
 * Listens for `file-changed` events emitted by the Rust backend, refreshes
 * the sidebar tree for structural changes, and asks the session layer to
 * reload clean files or mark dirty files as externally conflicted.
 */

import type { UnlistenFn } from "@tauri-apps/api/event";
import { getFileParentPath } from "../lib/file-tree-model";
import type { ExternalDocumentSyncResult } from "./editor-session-service";
import { logCatchError } from "./lib/log-catch-error";
import { measureAsync } from "./perf";
import {
  type WatchDirectoryResult,
  watchDirectoryCommand,
  unwatchDirectoryCommand,
} from "./tauri-client/watch";

let latestFileWatcherToken = 0;
const DEFAULT_WATCH_DEBOUNCE_MS = 500;

/** Callback to refresh the sidebar tree after structural filesystem changes. */
export type RefreshTreeFn = (changedPath?: string) => Promise<void>;

/** Callback fired for any watched path change, even when the file is not open. */
export type HandleWatchedPathChangeFn = (path: string) => void | Promise<void>;

/** Callback to resolve the session transition for a watched file change. */
export type SyncExternalChangeFn = (
  path: string,
) => Promise<ExternalDocumentSyncResult>;

/** Configuration for the FileWatcher. */
export interface FileWatcherConfig {
  /** Refresh the sidebar tree after structural changes. */
  refreshTree: RefreshTreeFn;
  /** Handle non-document side effects for any changed watched path. */
  handleWatchedPathChange?: HandleWatchedPathChangeFn;
  /** Ask the session layer how this watched change should be handled. */
  syncExternalChange: SyncExternalChangeFn;
}

export interface FileChangedEvent {
  path: string;
  treeChanged: boolean;
  generation?: number;
  root?: string;
}

type FileChangedPayload = FileChangedEvent | string;

function normalizeFileChangedEvent(payload: FileChangedPayload): FileChangedEvent {
  if (typeof payload === "string") {
    return { path: payload, treeChanged: false };
  }
  return payload;
}

/**
 * Watches for external file changes in Tauri mode.
 *
 * When a watched file changes:
 * - If the change can affect directory contents: refresh the sidebar tree
 * - Ask the session layer whether to ignore, reload, or mark a conflict
 * - Leave conflict presentation to the React app shell
 */
export class FileWatcher {
  private readonly config: FileWatcherConfig;
  private unlisten: UnlistenFn | null = null;
  private watchToken: number | null = null;
  private watchRoot: string | null = null;
  private readonly pendingTreeRefreshes = new Map<string, string>();
  private treeRefreshTimer: number | null = null;
  private treeRefreshGeneration = 0;

  constructor(config: FileWatcherConfig) {
    this.config = config;
  }

  /** Start watching a directory for changes. */
  async watch(directoryPath: string): Promise<void> {
    const previousWatchToken = this.watchToken;
    const previousUnlisten = this.unlisten;
    const watchToken = ++latestFileWatcherToken;

    this.watchToken = watchToken;
    this.unlisten = null;
    this.watchRoot = null;
    this.clearPendingTreeRefreshes();

    // Listen for file-changed events from the backend.
    // Lazy-import to keep @tauri-apps/api/event out of the browser bundle (#446).
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<FileChangedPayload>("file-changed", (event) => {
      void this.handleFileChanged(event.payload, watchToken).catch(
        logCatchError("[file-watcher] handleFileChanged failed", event.payload),
      );
    });

    if (this.watchToken !== watchToken || latestFileWatcherToken !== watchToken) {
      unlisten();
      try {
        await unwatchDirectoryCommand(watchToken);
      } catch (error: unknown) {
        console.warn("[file-watcher] failed to clean up late backend watcher listener", watchToken, error);
      }
      return;
    }

    this.unlisten = unlisten;

    previousUnlisten?.();
    if (previousWatchToken !== null) {
      try {
        await unwatchDirectoryCommand(previousWatchToken);
      } catch (error: unknown) {
        console.warn("[file-watcher] failed to unwatch previous backend watcher during handoff", previousWatchToken, error);
      }
    }

    let watchResult: WatchDirectoryResult | boolean;
    try {
      watchResult = await watchDirectoryCommand(
        watchToken,
        DEFAULT_WATCH_DEBOUNCE_MS,
      );
    } catch (error: unknown) {
      if (this.unlisten === unlisten) {
        this.unlisten = null;
        unlisten();
      }
      if (this.watchToken === watchToken) {
        this.watchToken = null;
        this.watchRoot = null;
      }
      throw error;
    }
    const { applied: watchApplied, root: watchRoot } = normalizeWatchDirectoryResult(
      watchResult,
      directoryPath,
    );
    if (!watchApplied || this.watchToken !== watchToken || latestFileWatcherToken !== watchToken) {
      if (this.unlisten === unlisten) {
        this.unlisten = null;
        unlisten();
      }
      if (this.watchToken === watchToken) {
        this.watchToken = null;
        this.watchRoot = null;
      }
      try {
        await unwatchDirectoryCommand(watchToken);
      } catch (error: unknown) {
        console.warn("[file-watcher] failed to clean up stale backend watcher after watch handoff", watchToken, error);
      }
      return;
    }

    this.watchRoot = watchRoot;
  }

  /** Stop watching and clean up. */
  async unwatch(): Promise<void> {
    const watchToken = this.watchToken;
    const unlisten = this.unlisten;

    this.watchToken = null;
    this.unlisten = null;
    this.watchRoot = null;
    this.clearPendingTreeRefreshes();

    unlisten?.();
    if (watchToken !== null) {
      try {
        await unwatchDirectoryCommand(watchToken);
      } catch (error: unknown) {
        console.warn("[file-watcher] failed to stop backend watcher during teardown", watchToken, error);
      }
    }
  }

  /** Handle a file-changed event from the backend. */
  private async handleFileChanged(
    payload: FileChangedPayload,
    subscriptionToken: number | null = this.watchToken,
  ): Promise<void> {
    const event = normalizeFileChangedEvent(payload);
    if (!this.isCurrentWatcherEvent(event, subscriptionToken)) {
      return;
    }

    const { path: relativePath, treeChanged } = event;

    if (this.config.handleWatchedPathChange) {
      void Promise.resolve(this.config.handleWatchedPathChange(relativePath)).catch(
        logCatchError("[file-watcher] watched-path handler failed", relativePath),
      );
    }

    const syncResult = await this.config.syncExternalChange(relativePath);
    if (treeChanged && syncResult !== "self-change") {
      this.enqueueTreeRefresh(relativePath);
    }

  }

  private enqueueTreeRefresh(relativePath: string): void {
    const dir = getFileParentPath(relativePath);
    if (!this.pendingTreeRefreshes.has(dir)) {
      this.pendingTreeRefreshes.set(dir, relativePath);
    }
    if (this.treeRefreshTimer !== null) return;

    const generation = this.treeRefreshGeneration;
    this.treeRefreshTimer = window.setTimeout(() => {
      this.treeRefreshTimer = null;
      void this.flushPendingTreeRefreshes(generation);
    }, 0);
  }

  private clearPendingTreeRefreshes(): void {
    this.treeRefreshGeneration += 1;
    this.pendingTreeRefreshes.clear();
    if (this.treeRefreshTimer !== null) {
      window.clearTimeout(this.treeRefreshTimer);
      this.treeRefreshTimer = null;
    }
  }

  private async flushPendingTreeRefreshes(generation: number): Promise<void> {
    if (generation !== this.treeRefreshGeneration) {
      return;
    }
    const changedPaths = [...this.pendingTreeRefreshes.values()];
    this.pendingTreeRefreshes.clear();

    await Promise.all(changedPaths.map((changedPath) =>
      measureAsync("watch.refresh_tree", () => this.config.refreshTree(changedPath), {
        category: "watch",
        detail: changedPath,
      }).catch(logCatchError("[file-watcher] tree refresh failed", changedPath)),
    ));
  }

  private isCurrentWatcherEvent(
    event: FileChangedEvent,
    subscriptionToken: number | null,
  ): boolean {
    if (subscriptionToken !== null && this.watchToken !== subscriptionToken) {
      return false;
    }
    if (event.generation !== undefined && event.generation !== this.watchToken) {
      return false;
    }
    if (event.root !== undefined && this.watchRoot !== null && event.root !== this.watchRoot) {
      return false;
    }
    return true;
  }
}

function normalizeWatchDirectoryResult(
  result: WatchDirectoryResult | boolean,
  requestedRoot: string,
): WatchDirectoryResult {
  if (typeof result === "boolean") {
    return { applied: result, root: requestedRoot };
  }
  return result;
}
