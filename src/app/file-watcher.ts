/**
 * File watcher for detecting external changes in Tauri mode.
 *
 * Listens for `file-changed` events emitted by the Rust backend, refreshes
 * the sidebar tree for structural changes, and either silently reloads clean
 * open files or shows a notification bar for dirty ones.
 */

import type { UnlistenFn } from "@tauri-apps/api/event";
import type { ExternalDocumentSyncResult } from "./editor-session-service";
import { logCatchError } from "./lib/log-catch-error";
import { basename } from "./lib/utils";
import { measureAsync } from "./perf";
import {
  type WatchDirectoryResult,
  watchDirectoryCommand,
  unwatchDirectoryCommand,
} from "./tauri-client/watch";

let latestFileWatcherToken = 0;
const DEFAULT_WATCH_DEBOUNCE_MS = 500;

/** Callback to reload a file's content from disk. */
export type ReloadFileFn = (path: string) => Promise<void>;

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
  /** Reload a file from disk into the editor. */
  reloadFile: ReloadFileFn;
  /** Handle non-document side effects for any changed watched path. */
  handleWatchedPathChange?: HandleWatchedPathChangeFn;
  /** Ask the session layer how this watched change should be handled. */
  syncExternalChange: SyncExternalChangeFn;
  /** Container element for the notification bar. */
  container: HTMLElement;
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

function parentDir(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.substring(0, i);
}

/**
 * Watches for external file changes in Tauri mode.
 *
 * When a watched file changes:
 * - If the change can affect directory contents: refresh the sidebar tree
 * - Ask the session layer whether to ignore, reload, or prompt
 * - Show a notification bar only when the session says the file is dirty
 */
export class FileWatcher {
  private readonly config: FileWatcherConfig;
  private unlisten: UnlistenFn | null = null;
  private watchToken: number | null = null;
  private watchRoot: string | null = null;
  private notificationBar: HTMLElement | null = null;
  /** Tracks dirty files waiting for user action. */
  private readonly pendingNotifications: string[] = [];
  /** Path currently shown in the notification bar. */
  private activeNotificationPath: string | null = null;
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
        directoryPath,
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

    this.dismissNotification();
    this.pendingNotifications.length = 0;
    this.activeNotificationPath = null;
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

    if (syncResult === "ignore" || syncResult === "reloaded" || syncResult === "self-change") {
      return;
    }

    // File is dirty — show notification bar
    if (
      this.activeNotificationPath !== relativePath &&
      !this.pendingNotifications.includes(relativePath)
    ) {
      this.pendingNotifications.push(relativePath);
      this.showNextNotification();
    }
  }

  /** Show the next pending notification, if no file is currently active. */
  private showNextNotification(): void {
    if (this.activeNotificationPath !== null) return;
    const path = this.pendingNotifications[0];
    if (!path) return;

    this.activeNotificationPath = path;
    this.dismissNotification();

    const bar = document.createElement("div");
    bar.className = "file-watcher-notification";

    const message = document.createElement("span");
    message.className = "file-watcher-message";
    const displayName = basename(path);
    message.textContent =
      `"${displayName}" changed externally while you have local edits.`;
    bar.appendChild(message);

    const keepBtn = document.createElement("button");
    keepBtn.className = "file-watcher-btn file-watcher-btn-no";
    keepBtn.textContent = "Keep edits";
    keepBtn.title = "Keep the editor contents and leave the disk change unresolved.";
    keepBtn.addEventListener("click", () => {
      try {
        this.resolveNotification(path);
      } catch (e: unknown) {
        logCatchError("[file-watcher] dismiss button handler failed", path)(e);
      }
    });
    bar.appendChild(keepBtn);

    const reloadBtn = document.createElement("button");
    reloadBtn.className = "file-watcher-btn file-watcher-btn-yes";
    reloadBtn.textContent = "Reload from disk";
    reloadBtn.title = "Discard local edits and replace the editor contents with the disk version.";
    reloadBtn.addEventListener("click", () => {
      try {
        void this.config.reloadFile(path)
          .catch(logCatchError("[file-watcher] reloadFile failed", path))
          .finally(() => {
            this.resolveNotification(path);
          });
      } catch (e: unknown) {
        logCatchError("[file-watcher] reload button handler failed", path)(e);
        this.resolveNotification(path);
      }
    });
    bar.appendChild(reloadBtn);

    this.notificationBar = bar;
    this.config.container.prepend(bar);
  }

  private resolveNotification(path: string): void {
    if (this.activeNotificationPath !== path) return;
    this.dismissNotification();
    this.activeNotificationPath = null;
    if (this.pendingNotifications[0] === path) {
      this.pendingNotifications.shift();
    } else {
      const index = this.pendingNotifications.indexOf(path);
      if (index >= 0) this.pendingNotifications.splice(index, 1);
    }
    this.showNextNotification();
  }

  /** Dismiss the current notification bar. */
  private dismissNotification(): void {
    if (this.notificationBar) {
      this.notificationBar.remove();
      this.notificationBar = null;
    }
  }

  private enqueueTreeRefresh(relativePath: string): void {
    const dir = parentDir(relativePath);
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
