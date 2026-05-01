import { IncomingMessage, ServerResponse } from "node:http";
import { constants as fsConstants } from "node:fs";
import type { Stats } from "node:fs";
import fs, { type FileHandle } from "node:fs/promises";
import path from "node:path";

/** File entry matching the client-side FileEntry interface. */
interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileEntry[];
}

function isWithinRoot(rootDir: string, candidatePath: string): boolean {
  return candidatePath === rootDir || candidatePath.startsWith(rootDir + path.sep);
}

function decodeRequestPath(requestPath: string): string | null {
  try {
    return decodeURIComponent(requestPath);
  } catch (_error) {
    return null;
  }
}

function fileSystemErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

class FileChangedBeforeWriteError extends Error {
  readonly code = "ESTALE";

  constructor(filePath: string) {
    super(`File changed before write: ${filePath}`);
  }
}

class PathEscapedRootError extends Error {
  readonly code = "EESCAPE";
}

function sendFileSystemError(
  res: ServerResponse,
  error: unknown,
  decodedPath: string,
): boolean {
  const code = fileSystemErrorCode(error);
  if (code === "EESCAPE") {
    sendError(res, 403, "Path traversal not allowed");
    return true;
  }
  if (code === "ENOENT" || code === "ENOTDIR") {
    sendError(res, 404, `File not found: ${decodedPath}`);
    return true;
  }
  if (code === "EACCES" || code === "EPERM") {
    sendError(res, 403, `Permission denied: ${decodedPath}`);
    return true;
  }
  if (code === "EEXIST") {
    sendError(res, 409, `File already exists: ${decodedPath}`);
    return true;
  }
  if (code === "EISDIR") {
    sendError(res, 409, `Expected a file: ${decodedPath}`);
    return true;
  }
  if (code === "ESTALE") {
    sendError(res, 409, `File changed before write: ${decodedPath}`);
    return true;
  }
  return false;
}

async function resolveRealPathCandidate(candidatePath: string): Promise<string | null> {
  let currentPath = candidatePath;
  const unresolvedSegments: string[] = [];

  for (;;) {
    try {
      const realPath = await fs.realpath(currentPath);
      return path.resolve(realPath, ...unresolvedSegments.reverse());
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (code !== "ENOENT") {
        throw error;
      }
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return null;
    }

    unresolvedSegments.push(path.basename(currentPath));
    currentPath = parentPath;
  }
}

/** Resolve a request path to an absolute filesystem path, preventing traversal and symlink escape. */
async function resolveSafePath(rootDir: string, requestPath: string): Promise<string | null> {
  const decoded = decodeRequestPath(requestPath);
  if (decoded === null) {
    return null;
  }

  const candidatePath = path.resolve(rootDir, decoded);
  if (!isWithinRoot(rootDir, candidatePath)) {
    return null;
  }

  const realCandidatePath = await resolveRealPathCandidate(candidatePath);
  if (!realCandidatePath || !isWithinRoot(rootDir, realCandidatePath)) {
    return null;
  }

  return candidatePath;
}

export function isAllowedFileApiOrigin(
  req: Pick<IncomingMessage, "headers">,
  defaultProtocol = "http",
): boolean {
  const originHeader = req.headers.origin;
  if (!originHeader) {
    return true;
  }

  const host = req.headers.host;
  if (!host) {
    return false;
  }

  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol =
    (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto) ?? defaultProtocol;

  try {
    const origin = new URL(originHeader);
    return origin.protocol === `${protocol}:` && origin.host === host;
  } catch (_error) {
    return false;
  }
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

let atomicWriteCounter = 0;

function sameFileStats(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function createAtomicWriteTempFile(parentDir: string, mode?: number): Promise<{
  tempPath: string;
  handle: FileHandle;
}> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 100; attempt += 1) {
    atomicWriteCounter += 1;
    const tempPath = path.join(
      parentDir,
      `.coflat-write-${process.pid}-${Date.now()}-${atomicWriteCounter}.tmp`,
    );

    try {
      const handle = await fs.open(tempPath, "wx", mode);
      return { tempPath, handle };
    } catch (error: unknown) {
      if (fileSystemErrorCode(error) !== "EEXIST") {
        throw error;
      }
      lastError = error;
    }
  }

  throw lastError ?? new Error("Failed to create atomic write temp file");
}

async function writeTempFile(
  parentDir: string,
  content: string | Uint8Array,
  mode?: number,
): Promise<string> {
  const { tempPath, handle } = await createAtomicWriteTempFile(parentDir, mode);
  let closed = false;

  try {
    if (typeof content === "string") {
      await handle.writeFile(content, "utf-8");
    } else {
      await handle.writeFile(content);
    }
    if (mode !== undefined) {
      await handle.chmod(mode);
    }
    await handle.sync();
    await handle.close();
    closed = true;
  } catch (error: unknown) {
    if (!closed) {
      try {
        await handle.close();
      } catch (_closeError: unknown) {
        // Preserve the original write/sync/close error while still cleaning up the temp path.
      }
    }
    await fs.rm(tempPath, { force: true });
    throw error;
  }

  return tempPath;
}

async function verifyExistingTargetWritable(targetPath: string): Promise<void> {
  const handle = await fs.open(targetPath, fsConstants.O_WRONLY);
  await handle.close();
}

async function syncDirectory(dirPath: string): Promise<void> {
  if (process.platform === "win32") {
    return;
  }

  let handle: FileHandle | null = null;
  try {
    handle = await fs.open(dirPath, "r");
    await handle.sync();
  } catch (error: unknown) {
    const code = fileSystemErrorCode(error);
    if (code === "EINVAL" || code === "EISDIR" || code === "ENOSYS" || code === "ENOTSUP") {
      return;
    }
    throw error;
  } finally {
    if (handle) {
      await handle.close();
    }
  }
}

async function writeAtomicExistingFile(
  rootDir: string,
  safePath: string,
  content: string | Uint8Array,
): Promise<void> {
  const targetPath = await fs.realpath(safePath);
  if (!isWithinRoot(rootDir, targetPath)) {
    throw new PathEscapedRootError();
  }

  const expectedStats = await fs.stat(targetPath);
  await verifyExistingTargetWritable(targetPath);
  const targetMode = expectedStats.mode & 0o7777;
  const targetDir = path.dirname(targetPath);
  const tempPath = await writeTempFile(targetDir, content, targetMode);

  try {
    const requestPathBeforeRename = await fs.realpath(safePath);
    if (!isWithinRoot(rootDir, requestPathBeforeRename)) {
      throw new PathEscapedRootError();
    }
    if (requestPathBeforeRename !== targetPath) {
      throw new FileChangedBeforeWriteError(safePath);
    }

    const actualStats = await fs.stat(targetPath);
    if (!sameFileStats(expectedStats, actualStats)) {
      throw new FileChangedBeforeWriteError(targetPath);
    }

    await verifyExistingTargetWritable(targetPath);
    await fs.rename(tempPath, targetPath);
    await syncDirectory(targetDir);
  } catch (error: unknown) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
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
    if (!isAllowedFileApiOrigin(req)) {
      sendError(res, 403, "Cross-origin file API access is not allowed");
      return true;
    }

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return true;
    }

    if (method === "GET" && (decodedPath === "" || decodedPath === "/")) {
      const tree = await buildTree(rootDir, rootDir);
      sendJson(res, 200, tree);
      return true;
    }

    if (method === "GET") {
      const safePath = await resolveSafePath(rootDir, decodedPath);
      if (!safePath) {
        sendError(res, 403, "Path traversal not allowed");
        return true;
      }

      try {
        const content = await fs.readFile(safePath, "utf-8");
        sendJson(res, 200, { content });
      } catch (error: unknown) {
        if (!sendFileSystemError(res, error, decodedPath)) {
          throw error;
        }
      }
      return true;
    }

    if (method === "PUT") {
      const safePath = await resolveSafePath(rootDir, decodedPath);
      if (!safePath) {
        sendError(res, 403, "Path traversal not allowed");
        return true;
      }

      const body = await readBody(req);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch (_error) {
        sendError(res, 400, "Invalid JSON body");
        return true;
      }
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        typeof (parsed as { content?: unknown }).content !== "string"
      ) {
        sendError(res, 400, "Expected JSON body of shape { content: string }");
        return true;
      }
      const { content } = parsed as { content: string };

      try {
        await writeAtomicExistingFile(rootDir, safePath, content);
      } catch (error: unknown) {
        if (!sendFileSystemError(res, error, decodedPath)) {
          throw error;
        }
        return true;
      }
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (method === "POST") {
      const safePath = await resolveSafePath(rootDir, decodedPath);
      if (!safePath) {
        sendError(res, 403, "Path traversal not allowed");
        return true;
      }

      const body = await readBody(req);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch (_error) {
        sendError(res, 400, "Invalid JSON body");
        return true;
      }
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        ((parsed as { content?: unknown }).content !== undefined &&
          typeof (parsed as { content?: unknown }).content !== "string")
      ) {
        sendError(res, 400, "Expected JSON body of shape { content?: string }");
        return true;
      }
      const { content } = parsed as { content?: string };

      try {
        await fs.access(safePath);
        sendError(res, 409, `File already exists: ${decodedPath}`);
        return true;
      } catch (error: unknown) {
        const code = fileSystemErrorCode(error);
        if (code !== "ENOENT" && code !== "ENOTDIR") {
          if (!sendFileSystemError(res, error, decodedPath)) {
            throw error;
          }
          return true;
        }
      }

      try {
        await fs.mkdir(path.dirname(safePath), { recursive: true });
        await fs.writeFile(safePath, content ?? "", { encoding: "utf-8", flag: "wx" });
      } catch (error: unknown) {
        if (!sendFileSystemError(res, error, decodedPath)) {
          throw error;
        }
        return true;
      }
      sendJson(res, 201, { ok: true });
      return true;
    }

    if (method === "DELETE") {
      const safePath = await resolveSafePath(rootDir, decodedPath);
      if (!safePath) {
        sendError(res, 403, "Path traversal not allowed");
        return true;
      }

      try {
        await fs.unlink(safePath);
        sendJson(res, 200, { ok: true });
      } catch (error: unknown) {
        if (!sendFileSystemError(res, error, decodedPath)) {
          throw error;
        }
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
