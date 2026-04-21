// @vitest-environment node

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { handleFileApi } from "./file-api.js";

async function createTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function startFileApiServer(rootDir: string): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = createServer(async (req, res) => {
    const handled = await handleFileApi(req, res, rootDir);
    if (!handled) {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as AddressInfo;
  const close = async (): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  };

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close,
  };
}

const cleanupPaths = new Set<string>();
const cleanupServers = new Set<() => Promise<void>>();

afterEach(async () => {
  for (const close of cleanupServers) {
    await close();
  }
  cleanupServers.clear();

  for (const dirPath of cleanupPaths) {
    await fs.rm(dirPath, { recursive: true, force: true });
  }
  cleanupPaths.clear();
});

async function setupServer(prefix: string): Promise<{ rootDir: string; baseUrl: string }> {
  const rootDir = await fs.realpath(await createTempDir(prefix));
  cleanupPaths.add(rootDir);
  const { baseUrl, close } = await startFileApiServer(rootDir);
  cleanupServers.add(close);
  return { rootDir, baseUrl };
}

async function apiFetch(
  baseUrl: string,
  requestPath: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${baseUrl}${requestPath}`, init);
}

describe("handleFileApi", () => {
  it("rejects cross-origin requests", async () => {
    const { rootDir, baseUrl } = await setupServer("coflat-file-api-");
    await fs.writeFile(path.join(rootDir, "note.md"), "hello", "utf-8");

    const response = await apiFetch(baseUrl, "/api/files/note.md", {
      headers: { Origin: "http://evil.example" },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "Cross-origin file API access is not allowed",
    });
  });

  it("allows same-origin reads", async () => {
    const { rootDir, baseUrl } = await setupServer("coflat-file-api-");
    await fs.writeFile(path.join(rootDir, "note.md"), "hello", "utf-8");

    const response = await apiFetch(baseUrl, "/api/files/note.md", {
      headers: { Origin: baseUrl },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ content: "hello" });
  });

  it("does not collapse directory read errors into not found", async () => {
    const { rootDir, baseUrl } = await setupServer("coflat-file-api-");
    await fs.mkdir(path.join(rootDir, "docs"));

    const response = await apiFetch(baseUrl, "/api/files/docs", {
      headers: { Origin: baseUrl },
    });

    expect(response.status).not.toBe(404);
    await expect(response.json()).resolves.not.toMatchObject({
      error: "File not found: docs",
    });
  });

  it("rejects reads through symlinks that escape the project root", async () => {
    const { rootDir, baseUrl } = await setupServer("coflat-file-api-");
    const outsideDir = await createTempDir("coflat-file-api-outside-");
    cleanupPaths.add(outsideDir);

    const secretPath = path.join(outsideDir, "secret.md");
    await fs.writeFile(secretPath, "secret", "utf-8");
    await fs.symlink(secretPath, path.join(rootDir, "secret.md"));

    const response = await apiFetch(baseUrl, "/api/files/secret.md", {
      headers: { Origin: baseUrl },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "Path traversal not allowed",
    });
  });

  it("rejects writes through symlinked directories that escape the project root", async () => {
    const { rootDir, baseUrl } = await setupServer("coflat-file-api-");
    const outsideDir = await createTempDir("coflat-file-api-outside-");
    cleanupPaths.add(outsideDir);

    await fs.symlink(outsideDir, path.join(rootDir, "escape"));

    const response = await apiFetch(baseUrl, "/api/files/escape/pwned.md", {
      method: "POST",
      headers: {
        Origin: baseUrl,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: "owned" }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "Path traversal not allowed",
    });
    await expect(fs.access(path.join(outsideDir, "pwned.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
