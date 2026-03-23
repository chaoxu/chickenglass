/**
 * File watcher for detecting external changes in Tauri mode.
 *
 * Listens for `file-changed` events emitted by the Rust backend and either
 * silently reloads clean files or shows a notification bar for dirty files.
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { basename } from "./lib/utils";
import { measureAsync } from "./perf";
import { watchDirectoryCommand, unwatchDirectoryCommand } from "./tauri-client/watch";

/** Callback to check whether a file is open in a tab. */
export type IsFileOpenFn = (path: string) => boolean;

/** Callback to check whether a file has unsaved changes. */
export type IsFileDirtyFn = (path: string) => boolean;

/** Callback to reload a file's content from disk. */
export type ReloadFileFn = (path: string) => Promise<void>;

/** Configuration for the FileWatcher. */
export interface FileWatcherConfig {
  /** Check whether a file is currently open in a tab. */
  isFileOpen: IsFileOpenFn;
  /** Check whether a file has unsaved changes. */
  isFileDirty: IsFileDirtyFn;
  /** Reload a file from disk into the editor. */
  reloadFile: ReloadFileFn;
  /** Container element for the notification bar. */
  container: HTMLElement;
}

/**
 * Watches for external file changes in Tauri mode.
 *
 * When a watched file changes:
 * - If the file is open and clean: reload silently
 * - If the file is open and dirty: show a notification bar
 * - If the file is not open: ignore
 */
export class FileWatcher {
  private readonly config: FileWatcherConfig;
  private unlisten: UnlistenFn | null = null;
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
    // Stop any previous watcher
    await this.unwatch();

    // Tell the Rust backend to start watching
    await watchDirectoryCommand(directoryPath);

    // Listen for file-changed events from the backend
    this.unlisten = await listen<string>("file-changed", (event) => {
      this.handleFileChanged(event.payload);
    });
  }

  /** Stop watching and clean up. */
  async unwatch(): Promise<void> {
    if (this.unlisten) {
      this.unlisten();
      this.unlisten = null;
    }

    try {
      await unwatchDirectoryCommand();
    } catch {
      // best-effort: backend may already be stopped during teardown
    }

    this.dismissNotification();
    this.pendingNotifications.length = 0;
    this.activeNotificationPath = null;
  }

  /** Handle a file-changed event from the backend. */
  private handleFileChanged(relativePath: string): void {
    if (!this.config.isFileOpen(relativePath)) {
      return;
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
      void this.config.reloadFile(path).finally(() => {
        this.resolveNotification(path);
      });
    });
    bar.appendChild(yesBtn);

    const noBtn = document.createElement("button");
    noBtn.className = "file-watcher-btn file-watcher-btn-no";
    noBtn.textContent = "No";
    noBtn.addEventListener("click", () => {
      this.resolveNotification(path);
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
