import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_BROWSER_ARTIFACT_ROOT,
  resolveBrowserArtifactDir,
} from "./browser-failure-artifacts.mjs";

function readGitCommit(commandRunner = spawnSync) {
  const result = commandRunner("git", ["rev-parse", "--short=12", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || (result.status ?? 1) !== 0) {
    return null;
  }
  return String(result.stdout ?? "").trim() || null;
}

function nowIso(now = new Date()) {
  return now instanceof Date ? now.toISOString() : new Date(now).toISOString();
}

export function createBrowserRunManifest(options = {}) {
  const {
    appUrl = null,
    argv = [],
    browserMode = null,
    commandRunner = spawnSync,
    headless = null,
    label = "browser-run",
    now = new Date(),
    root = DEFAULT_BROWSER_ARTIFACT_ROOT,
  } = options;
  const outDir = options.outDir ?? resolveBrowserArtifactDir({ label, now, root });
  const manifestPath = join(outDir, "browser-run-manifest.json");
  const startedAt = nowIso(now);
  const gitCommit = options.gitCommit ?? readGitCommit(commandRunner);

  const write = (payload = {}) => {
    const endedAt = payload.endedAt ?? new Date();
    const manifest = {
      appUrl,
      argv,
      browserMode,
      endedAt: nowIso(endedAt),
      gitCommit,
      headless,
      label,
      manifestPath,
      results: payload.results ?? [],
      startedAt,
      status: payload.status ?? "unknown",
      summary: payload.summary ?? null,
      timings: {
        wallMs: Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime()),
        ...(payload.timings ?? {}),
      },
    };
    mkdirSync(outDir, { recursive: true });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return {
      manifest,
      manifestPath,
      outDir,
    };
  };

  return {
    manifestPath,
    outDir,
    startedAt,
    write,
  };
}
