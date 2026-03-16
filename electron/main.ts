import { app, BrowserWindow, ipcMain, dialog } from "electron";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/** Default window dimensions. */
const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 800;

/** Whether the app is running in development mode. */
const isDev = !app.isPackaged;

/** The currently open project root directory. */
let projectRoot: string | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    title: "Chickenglass",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    const devServerUrl = process.env["VITE_DEV_SERVER_URL"] ?? "http://localhost:5173";
    win.loadURL(devServerUrl);
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  return win;
}

interface FileTreeEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileTreeEntry[];
}

/** Recursively build a file tree entry for a directory. */
async function buildFileTree(
  dirPath: string,
  rootPath: string,
): Promise<FileTreeEntry> {
  const name = path.basename(dirPath);
  const relativePath = path.relative(rootPath, dirPath);
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  const children: FileTreeEntry[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules") continue;

    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      children.push(await buildFileTree(fullPath, rootPath));
    } else {
      children.push({
        name: entry.name,
        path: path.relative(rootPath, fullPath),
        isDirectory: false,
      });
    }
  }

  // Sort: directories first, then alphabetical
  children.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return {
    name,
    path: relativePath,
    isDirectory: true,
    children,
  };
}

/** Resolve a relative path against the project root. */
function resolveFilePath(relativePath: string): string {
  if (!projectRoot) {
    throw new Error("No project directory is open");
  }
  const resolved = path.resolve(projectRoot, relativePath);
  // Prevent path traversal outside the project root
  if (!resolved.startsWith(projectRoot)) {
    throw new Error("Path traversal outside project root is not allowed");
  }
  return resolved;
}

function registerIpcHandlers(): void {
  ipcMain.handle("fs:listTree", async () => {
    if (!projectRoot) return null;
    return buildFileTree(projectRoot, projectRoot);
  });

  ipcMain.handle("fs:readFile", async (_event, relativePath: string) => {
    const fullPath = resolveFilePath(relativePath);
    return fs.readFile(fullPath, "utf-8");
  });

  ipcMain.handle(
    "fs:writeFile",
    async (_event, relativePath: string, content: string) => {
      const fullPath = resolveFilePath(relativePath);
      await fs.writeFile(fullPath, content, "utf-8");
    },
  );

  ipcMain.handle(
    "fs:createFile",
    async (_event, relativePath: string, content?: string) => {
      const fullPath = resolveFilePath(relativePath);
      const dir = path.dirname(fullPath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(fullPath, content ?? "", "utf-8");
    },
  );

  ipcMain.handle("fs:exists", async (_event, relativePath: string) => {
    const fullPath = resolveFilePath(relativePath);
    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle("dialog:openDirectory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Open Project Directory",
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    projectRoot = result.filePaths[0];
    return projectRoot;
  });

  ipcMain.handle("dialog:openFile", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [
        { name: "Markdown", extensions: ["md", "markdown"] },
        { name: "All Files", extensions: ["*"] },
      ],
      title: "Open File",
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("dialog:saveFile", async () => {
    const result = await dialog.showSaveDialog({
      filters: [
        { name: "Markdown", extensions: ["md", "markdown"] },
        { name: "All Files", extensions: ["*"] },
      ],
      title: "Save File",
    });
    if (result.canceled || !result.filePath) return null;
    return result.filePath;
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
