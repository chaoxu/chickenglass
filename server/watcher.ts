import path from "node:path";
import { watch, type FSWatcher as ChokidarWatcher } from "chokidar";
import { WebSocketServer, type WebSocket } from "ws";
import type { Server } from "node:http";

/** Change event sent to WebSocket clients. */
export interface FileChangeEvent {
  type: "add" | "change" | "delete";
  path: string;
}

/** File watcher that notifies WebSocket clients of file changes. */
export class FileWatcher {
  private readonly wss: WebSocketServer;
  private chokidarWatcher: ChokidarWatcher | undefined;
  private readonly rootDir: string;
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(server: Server, rootDir: string) {
    this.rootDir = rootDir;
    this.wss = new WebSocketServer({ server, path: "/ws" });

    this.wss.on("connection", (ws: WebSocket) => {
      ws.send(JSON.stringify({ type: "connected" }));
    });
  }

  /** Start watching the root directory for file changes. */
  start(): void {
    this.chokidarWatcher = watch(this.rootDir, {
      ignoreInitial: true,
      ignored: (filePath: string) => {
        const relative = path.relative(this.rootDir, filePath);
        // Allow root dir itself
        if (relative === "") return false;
        return this.shouldIgnore(relative);
      },
    });

    this.chokidarWatcher.on("add", (filePath) => {
      this.handleEvent("add", filePath);
    });

    this.chokidarWatcher.on("change", (filePath) => {
      this.handleEvent("change", filePath);
    });

    this.chokidarWatcher.on("unlink", (filePath) => {
      this.handleEvent("delete", filePath);
    });

    this.chokidarWatcher.on("error", (err) => {
      console.error(`Watcher error for ${this.rootDir}:`, err);
    });
  }

  /** Stop all watchers and close the WebSocket server. */
  stop(): void {
    if (this.chokidarWatcher) {
      // close() returns a promise but we don't need to await it during shutdown
      void this.chokidarWatcher.close();
      this.chokidarWatcher = undefined;
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.wss.close();
  }

  private handleEvent(type: FileChangeEvent["type"], absolutePath: string): void {
    const relativePath = path.relative(this.rootDir, absolutePath);
    this.debounceNotify(relativePath, type);
  }

  private shouldIgnore(filename: string): boolean {
    const parts = filename.split(path.sep);
    return parts.some(
      (part) => part.startsWith(".") || part === "node_modules" || part === "dist",
    );
  }

  private debounceNotify(filePath: string, type: FileChangeEvent["type"]): void {
    const existing = this.debounceTimers.get(filePath);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      this.broadcast({ type, path: filePath });
    }, 100);

    this.debounceTimers.set(filePath, timer);
  }

  private broadcast(event: FileChangeEvent): void {
    const message = JSON.stringify(event);
    for (const client of this.wss.clients) {
      if (client.readyState === 1) {
        client.send(message);
      }
    }
  }
}
