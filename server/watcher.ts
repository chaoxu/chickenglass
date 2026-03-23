import { existsSync, readdirSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { Server } from "node:http";

/** Change event sent to WebSocket clients. */
export interface FileChangeEvent {
  type: "add" | "change" | "delete";
  path: string;
}

export function classifyFsWatchEvent(
  eventType: "rename" | "change",
  relativePath: string,
  pathExists: boolean,
  knownPaths: ReadonlySet<string>,
): FileChangeEvent["type"] {
  if (eventType === "change") {
    return "change";
  }

  if (!pathExists) {
    return "delete";
  }

  return knownPaths.has(relativePath) ? "change" : "add";
}

export function removeKnownPathPrefix(knownPaths: Set<string>, removedPath: string): void {
  const removedPrefix = `${removedPath}${path.sep}`;
  for (const knownPath of knownPaths) {
    if (knownPath === removedPath || knownPath.startsWith(removedPrefix)) {
      knownPaths.delete(knownPath);
    }
  }
}

/** File watcher that notifies WebSocket clients of file changes. */
export class FileWatcher {
  private readonly wss: WebSocketServer;
  private readonly watchers: FSWatcher[] = [];
  private readonly rootDir: string;
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private readonly knownPaths = new Set<string>();

  constructor(server: Server, rootDir: string) {
    this.rootDir = rootDir;
    this.wss = new WebSocketServer({ server, path: "/ws" });

    this.wss.on("connection", (ws: WebSocket) => {
      ws.send(JSON.stringify({ type: "connected" }));
    });
  }

  /** Start watching the root directory for file changes. */
  start(): void {
    this.seedKnownPaths(this.rootDir);
    this.watchDirectory(this.rootDir);
  }

  /** Stop all watchers and close the WebSocket server. */
  stop(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers.length = 0;
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.wss.close();
  }

  private watchDirectory(dirPath: string): void {
    try {
      const watcher = watch(dirPath, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const relativePath = path.normalize(filename.toString());
        if (this.shouldIgnore(relativePath)) return;

        const absolutePath = path.join(this.rootDir, relativePath);
        const pathExists = existsSync(absolutePath);
        const type = classifyFsWatchEvent(eventType, relativePath, pathExists, this.knownPaths);

        if (type === "delete") {
          removeKnownPathPrefix(this.knownPaths, relativePath);
        } else {
          this.knownPaths.add(relativePath);
        }

        this.debounceNotify(relativePath, type);
      });

      watcher.on("error", (err) => {
        console.error(`Watcher error for ${dirPath}:`, err);
      });

      this.watchers.push(watcher);
    } catch (err) {
      console.error(`Failed to watch ${dirPath}:`, err);
    }
  }

  private shouldIgnore(filename: string): boolean {
    const parts = filename.split(path.sep);
    return parts.some(
      (part) => part.startsWith(".") || part === "node_modules" || part === "dist",
    );
  }

  private seedKnownPaths(dirPath: string): void {
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      if (this.shouldIgnore(entry.name)) {
        continue;
      }

      const entryPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(this.rootDir, entryPath);
      this.knownPaths.add(relativePath);

      if (entry.isDirectory()) {
        this.seedKnownPaths(entryPath);
      }
    }
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
