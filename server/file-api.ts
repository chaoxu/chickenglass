import { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

/** File entry matching the client-side FileEntry interface. */
interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileEntry[];
}

/** Resolve a request path to an absolute filesystem path, preventing traversal. */
function resolveSafePath(rootDir: string, requestPath: string): string | null {
  const decoded = decodeURIComponent(requestPath);
  const resolved = path.resolve(rootDir, decoded);
  if (!resolved.startsWith(rootDir + path.sep) && resolved !== rootDir) {
    return null;
  }
  return resolved;
}

/** Read a file tree recursively. */
async function buildTree(dirPath: string, rootDir: string): Promise<FileEntry> {
  const name = path.basename(dirPath) || "project";
  const relativePath = path.relative(rootDir, dirPath);

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const children: FileEntry[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules") continue;

    const entryPath = path.join(dirPath, entry.name);
    const entryRelative = path.relative(rootDir, entryPath);

    if (entry.isDirectory()) {
      const subtree = await buildTree(entryPath, rootDir);
      children.push(subtree);
    } else {
      children.push({
        name: entry.name,
        path: entryRelative,
        isDirectory: false,
      });
    }
  }

  const entry: FileEntry = { name, path: relativePath, isDirectory: true, children };
  sortTree(entry);

  return entry;
}

/** Sort a file tree: directories first, then alphabetical. */
function sortTree(entry: FileEntry): void {
  if (!entry.children) return;
  entry.children.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
  for (const child of entry.children) {
    sortTree(child);
  }
}

/** Send a JSON response. */
function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

/** Send an error response. */
function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

/** Read the full request body as a string. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/**
 * Handle file API requests.
 * Returns true if the request was handled, false otherwise.
 */
export async function handleFileApi(
  req: IncomingMessage,
  res: ServerResponse,
  rootDir: string,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname;

  if (!pathname.startsWith("/api/files")) {
    return false;
  }

  const method = req.method ?? "GET";
  const filePath = pathname.slice("/api/files".length);
  const decodedPath = filePath.startsWith("/") ? filePath.slice(1) : filePath;

  try {
    if (method === "GET" && (decodedPath === "" || decodedPath === "/")) {
      const tree = await buildTree(rootDir, rootDir);
      sendJson(res, 200, tree);
      return true;
    }

    if (method === "GET") {
      const safePath = resolveSafePath(rootDir, decodedPath);
      if (!safePath) {
        sendError(res, 403, "Path traversal not allowed");
        return true;
      }

      try {
        const content = await fs.readFile(safePath, "utf-8");
        sendJson(res, 200, { content });
      } catch {
        sendError(res, 404, `File not found: ${decodedPath}`);
      }
      return true;
    }

    if (method === "PUT") {
      const safePath = resolveSafePath(rootDir, decodedPath);
      if (!safePath) {
        sendError(res, 403, "Path traversal not allowed");
        return true;
      }

      const body = await readBody(req);
      const { content } = JSON.parse(body) as { content: string };

      try {
        await fs.access(safePath);
      } catch {
        sendError(res, 404, `File not found: ${decodedPath}`);
        return true;
      }

      await fs.writeFile(safePath, content, "utf-8");
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (method === "POST") {
      const safePath = resolveSafePath(rootDir, decodedPath);
      if (!safePath) {
        sendError(res, 403, "Path traversal not allowed");
        return true;
      }

      const body = await readBody(req);
      const { content } = JSON.parse(body) as { content?: string };

      try {
        await fs.access(safePath);
        sendError(res, 409, `File already exists: ${decodedPath}`);
        return true;
      } catch {
        // File does not exist, proceed to create
      }

      await fs.mkdir(path.dirname(safePath), { recursive: true });
      await fs.writeFile(safePath, content ?? "", "utf-8");
      sendJson(res, 201, { ok: true });
      return true;
    }

    if (method === "DELETE") {
      const safePath = resolveSafePath(rootDir, decodedPath);
      if (!safePath) {
        sendError(res, 403, "Path traversal not allowed");
        return true;
      }

      try {
        await fs.unlink(safePath);
        sendJson(res, 200, { ok: true });
      } catch {
        sendError(res, 404, `File not found: ${decodedPath}`);
      }
      return true;
    }

    sendError(res, 405, `Method ${method} not allowed`);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    sendError(res, 500, message);
    return true;
  }
}
