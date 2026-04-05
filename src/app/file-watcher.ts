/**
 * File watcher for detecting external changes in Tauri mode.
 *
 * Listens for `file-changed` events emitted by the Rust backend, refreshes
 * the sidebar tree for structural changes, and either silently reloads clean
 * open files or shows a notification bar for dirty ones.
 */

import type { UnlistenFn } from "@tauri-apps/api/event";
import { basename } from "./lib/utils";
import { measureAsync } from "./perf";
import { watchDirectoryCommand, unwatchDirectoryCommand } from "./tauri-client/watch";

let latestFileWatcherToken = 0;

/** Callback to check whether a file is open in a tab. */
export type IsFileOpenFn = (path: string) => boolean;

/** Callback to check whether a file has unsaved changes. */
export type IsFileDirtyFn = (path: string) => boolean;

/** Callback to reload a file's content from disk. */
export type ReloadFileFn = (path: string) => Promise<void>;

/** Callback to refresh the sidebar tree after structural filesystem changes. */
export type RefreshTreeFn = (changedPath?: string) => Promise<void>;

/** Callback fired for any watched path change, even when the file is not open. */
export type HandleWatchedPathChangeFn = (path: string) => void | Promise<void>;

/**
 * Callback to check whether a file-changed event was caused by the app's
 * own save. Receives the path and returns a promise that resolves to true
 * if the change should be suppressed.
 */
export type IsSelfChangeFn = (path: string) => Promise<boolean>;

/** Configuration for the FileWatcher. */
export interface FileWatcherConfig {
  /** Check whether a file is currently open in a tab. */
  isFileOpen: IsFileOpenFn;
  /** Check whether a file has unsaved changes. */
  isFileDirty: IsFileDirtyFn;
  /** Refresh the sidebar tree after structural changes. */
  refreshTree: RefreshTreeFn;
  /** Reload a file from disk into the editor. */
  reloadFile: ReloadFileFn;
  /** Handle non-document side effects for any changed watched path. */
  handleWatchedPathChange?: HandleWatchedPathChangeFn;
  /** Check whether a change event was caused by the app's own save. */
  isSelfChange?: IsSelfChangeFn;
  /** Container element for the notification bar. */
  container: HTMLElement;
}

export interface FileChangedEvent {
  path: string;
  treeChanged: boolean;
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
 * - If the file is open and clean: reload silently
 * - If the file is open and dirty: show a notification bar
 * - If the file is not open: skip editor reload/notification handling
 */
export class FileWatcher {
  private readonly config: FileWatcherConfig;
  private unlisten: UnlistenFn | null = null;
  private watchToken: number | null = null;
  private notificationBar: HTMLElement | null = null;
  /** Tracks dirty files waiting for user action. */
  private readonly pendingNotifications: string[] = [];
  /** Path currently shown in the notification bar. */
  private activeNotificationPath: string | null = null;

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

    previousUnlisten?.();
    if (previousWatchToken !== null) {
      try {
        await unwatchDirectoryCommand(previousWatchToken);
      } catch (error: unknown) {
        console.warn("[file-watcher] failed to unwatch previous backend watcher during handoff", previousWatchToken, error);
      }
    }

    const watchApplied = await watchDirectoryCommand(directoryPath, watchToken);
    if (!watchApplied || this.watchToken !== watchToken || latestFileWatcherToken !== watchToken) {
      try {
        await unwatchDirectoryCommand(watchToken);
      } catch (error: unknown) {
        console.warn("[file-watcher] failed to clean up stale backend watcher after watch handoff", watchToken, error);
      }
      return;
    }

    // Listen for file-changed events from the backend.
    // Lazy-import to keep @tauri-apps/api/event out of the browser bundle (#446).
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<FileChangedPayload>("file-changed", (event) => {
      void this.handleFileChanged(event.payload).catch((e: unknown) => {
        console.error("[file-watcher] handleFileChanged failed", event.payload, e);
      });
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
  }

  /** Stop watching and clean up. */
  async unwatch(): Promise<void> {
    const watchToken = this.watchToken;
    const unlisten = this.unlisten;

    this.watchToken = null;
    this.unlisten = null;

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
  private async handleFileChanged(payload: FileChangedPayload): Promise<void> {
    const { path: relativePath, treeChanged } = normalizeFileChangedEvent(payload);

    if (treeChanged) {
      void measureAsync("watch.refresh_tree", () => this.config.refreshTree(relativePath), {
        category: "watch",
        detail: relativePath,
      }).catch((e: unknown) => {
        console.error("[file-watcher] tree refresh failed", relativePath, e);
      });
    }

    if (this.config.handleWatchedPathChange) {
      void Promise.resolve(this.config.handleWatchedPathChange(relativePath)).catch((e: unknown) => {
        console.error("[file-watcher] watched-path handler failed", relativePath, e);
      });
    }

    if (!this.config.isFileOpen(relativePath)) {
      return;
    }

    // Suppress events caused by the app's own save.
    if (this.config.isSelfChange) {
      try {
        if (await this.config.isSelfChange(relativePath)) {
          return;
        }
      } catch (error: unknown) {
        console.warn("[file-watcher] isSelfChange check failed; treating change as external", relativePath, error);
      }
    }

    if (!this.config.isFileDirty(relativePath)) {
      // File is clean — reload silently
      void measureAsync("watch.reload_clean_file", () => this.config.reloadFile(relativePath), {
        category: "watch",
        detail: relativePath,
      }).catch((e: unknown) => {
        console.error("[file-watcher] silent reload failed", relativePath, e);
      });
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
    message.textContent = `"${displayName}" changed externally. Reload?`;
    bar.appendChild(message);

    const yesBtn = document.createElement("button");
    yesBtn.className = "file-watcher-btn file-watcher-btn-yes";
    yesBtn.textContent = "Yes";
    yesBtn.addEventListener("click", () => {
      try {
        void this.config.reloadFile(path)
          .catch((e: unknown) => {
            console.error("[file-watcher] reloadFile failed", path, e);
          })
          .finally(() => {
            this.resolveNotification(path);
          });
      } catch (e: unknown) {
        console.error("[file-watcher] reload button handler failed", path, e);
        this.resolveNotification(path);
      }
    });
    bar.appendChild(yesBtn);

    const noBtn = document.createElement("button");
    noBtn.className = "file-watcher-btn file-watcher-btn-no";
    noBtn.textContent = "No";
    noBtn.addEventListener("click", () => {
      try {
        this.resolveNotification(path);
      } catch (e: unknown) {
        console.error("[file-watcher] dismiss button handler failed", path, e);
      }
    });
    bar.appendChild(noBtn);

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
}
