import { contextBridge, ipcRenderer } from "electron";

/** File entry matching the FileEntry interface in src/app/file-manager.ts. */
interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileEntry[];
}

/** Electron filesystem API exposed to the renderer process. */
interface ElectronFileSystemApi {
  listTree: () => Promise<FileEntry | null>;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  createFile: (path: string, content?: string) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
  openDirectory: () => Promise<string | null>;
  openFile: () => Promise<string | null>;
  saveFile: () => Promise<string | null>;
}

const api: ElectronFileSystemApi = {
  listTree: () => ipcRenderer.invoke("fs:listTree"),
  readFile: (path: string) => ipcRenderer.invoke("fs:readFile", path),
  writeFile: (path: string, content: string) =>
    ipcRenderer.invoke("fs:writeFile", path, content),
  createFile: (path: string, content?: string) =>
    ipcRenderer.invoke("fs:createFile", path, content),
  exists: (path: string) => ipcRenderer.invoke("fs:exists", path),
  openDirectory: () => ipcRenderer.invoke("dialog:openDirectory"),
  openFile: () => ipcRenderer.invoke("dialog:openFile"),
  saveFile: () => ipcRenderer.invoke("dialog:saveFile"),
};

contextBridge.exposeInMainWorld("electronFs", api);
