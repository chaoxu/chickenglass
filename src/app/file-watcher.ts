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
  /** Tracks paths with pending reload notifications to avoid duplicates. */
  private readonly pendingNotifications = new Set<string>();

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
      // Backend may already be stopped
    }

    this.dismissNotification();
    this.pendingNotifications.clear();
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
      });
      return;
    }

    // File is dirty — show notification bar
    if (!this.pendingNotifications.has(relativePath)) {
      this.pendingNotifications.add(relativePath);
      this.showNotification(relativePath);
    }
  }

  /** Show a notification bar asking the user to reload a dirty file. */
  private showNotification(path: string): void {
    // Remove any existing notification bar
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
      this.config.reloadFile(path);
      this.pendingNotifications.delete(path);
      this.dismissNotification();
    });
    bar.appendChild(yesBtn);

    const noBtn = document.createElement("button");
    noBtn.className = "file-watcher-btn file-watcher-btn-no";
    noBtn.textContent = "No";
    noBtn.addEventListener("click", () => {
      this.pendingNotifications.delete(path);
      this.dismissNotification();
    });
    bar.appendChild(noBtn);

    this.notificationBar = bar;
    this.config.container.prepend(bar);
  }

  /** Dismiss the current notification bar. */
  private dismissNotification(): void {
    if (this.notificationBar) {
      this.notificationBar.remove();
      this.notificationBar = null;
    }
  }
}
