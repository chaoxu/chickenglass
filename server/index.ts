import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { handleFileApi } from "./file-api.js";
import { FileWatcher } from "./watcher.js";

const DEFAULT_PORT = 3000;

/** MIME types for static file serving. */
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

/** Serve a static file from the dist directory. */
async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  distDir: string,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  let pathname = url.pathname;

  // SPA: all non-file paths serve index.html
  if (pathname === "/" || !pathname.includes(".")) {
    pathname = "/index.html";
  }

  const filePath = path.join(distDir, pathname);

  // Prevent directory traversal
  if (!filePath.startsWith(distDir + path.sep) && filePath !== distDir) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  } catch {
    // SPA fallback: serve index.html for missing files
    try {
      const indexData = await fs.readFile(path.join(distDir, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(indexData);
    } catch {
      res.writeHead(404);
      res.end("Not Found");
    }
  }
}

/** Parse command-line arguments. */
function parseArgs(args: string[]): { projectDir: string; port: number } {
  let projectDir = process.cwd();
  let port = DEFAULT_PORT;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port" || arg === "-p") {
      const next = args[i + 1];
      if (next !== undefined) {
        port = parseInt(next, 10);
        i++;
      }
    } else if (!arg.startsWith("-")) {
      projectDir = path.resolve(arg);
    }
  }

  return { projectDir, port };
}

/** Start the server. */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { projectDir, port } = parseArgs(args);
  const distDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "dist");

  // Verify project directory exists
  try {
    const stat = await fs.stat(projectDir);
    if (!stat.isDirectory()) {
      console.error(`Error: ${projectDir} is not a directory`);
      process.exit(1);
    }
  } catch {
    console.error(`Error: directory not found: ${projectDir}`);
    process.exit(1);
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS headers for development
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Try file API first
    const handled = await handleFileApi(req, res, projectDir);
    if (handled) return;

    // Fall back to static file serving
    await serveStatic(req, res, distDir);
  });

  const watcher = new FileWatcher(server, projectDir);
  watcher.start();

  // Graceful shutdown
  const shutdown = (): void => {
    console.log("\nShutting down...");
    watcher.stop();
    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  server.listen(port, () => {
    console.log(`Coflat server running at http://localhost:${port}`);
    console.log(`Serving project: ${projectDir}`);
    console.log(`Static files: ${distDir}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
