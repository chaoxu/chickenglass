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
import { TAURI_FILE_CHANGED_EVENT_CHANNEL } from "./tauri-client/bridge-metadata";
import { watchDirectoryCommand, unwatchDirectoryCommand } from "./tauri-client/watch";

let latestFileWatcherToken = 0;

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
  generation: number;
}

interface NormalizedFileChangedEvent {
  path: string;
  treeChanged: boolean;
  generation?: number;
}

export type FileChangedPayload = FileChangedEvent | NormalizedFileChangedEvent | string;

function normalizeFileChangedEvent(payload: FileChangedPayload): NormalizedFileChangedEvent {
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
 * - Ask the session layer whether to ignore, reload, or prompt
 * - Show a notification bar only when the session says the file is dirty
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

    // Listen before attaching the backend watcher so startup events cannot
    // race ahead of the frontend subscription.
    // Lazy-import to keep @tauri-apps/api/event out of the browser bundle (#446).
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<FileChangedEvent>(TAURI_FILE_CHANGED_EVENT_CHANNEL, (event) => {
      const payload = event.payload;
      if (payload.generation !== watchToken) {
        return;
      }
      void this.processFileChanged(payload).catch(
        logCatchError("[file-watcher] processFileChanged failed", payload),
      );
    });

    if (this.watchToken !== watchToken || latestFileWatcherToken !== watchToken) {
      unlisten();
      return;
    }

    let watchApplied = false;
    try {
      watchApplied = await watchDirectoryCommand(directoryPath, watchToken);
    } catch (error) {
      if (this.watchToken === watchToken) {
        this.watchToken = null;
      }
      unlisten();
      throw error;
    }

    if (!watchApplied || this.watchToken !== watchToken || latestFileWatcherToken !== watchToken) {
      unlisten();
      try {
        await unwatchDirectoryCommand(watchToken);
      } catch (error: unknown) {
        console.warn("[file-watcher] failed to clean up stale backend watcher after watch handoff", watchToken, error);
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

  /** Process a file-changed event from the backend or a test harness. */
  async processFileChanged(payload: FileChangedPayload): Promise<void> {
    const { path: relativePath, treeChanged } = normalizeFileChangedEvent(payload);

    if (treeChanged) {
      void measureAsync("watch.refresh_tree", () => this.config.refreshTree(relativePath), {
        category: "watch",
        detail: relativePath,
      }).catch(logCatchError("[file-watcher] tree refresh failed", relativePath));
    }

    if (this.config.handleWatchedPathChange) {
      void Promise.resolve(this.config.handleWatchedPathChange(relativePath)).catch(
        logCatchError("[file-watcher] watched-path handler failed", relativePath),
      );
    }

    const syncResult = await this.config.syncExternalChange(relativePath);
    if (syncResult === "ignore" || syncResult === "reloaded") {
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
          .catch(logCatchError("[file-watcher] reloadFile failed", path))
          .finally(() => {
            this.resolveNotification(path);
          });
      } catch (e: unknown) {
        logCatchError("[file-watcher] reload button handler failed", path)(e);
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
        logCatchError("[file-watcher] dismiss button handler failed", path)(e);
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
