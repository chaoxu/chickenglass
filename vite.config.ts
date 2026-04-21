import { execSync } from "node:child_process";
import { appendFileSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { OutputBundle } from "rollup";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import { visualizer } from "rollup-plugin-visualizer";

const DEBUG_EVENT_ENDPOINT = "/__coflat/debug-event";
const DEBUG_EVENT_DIR = path.join(tmpdir(), "coflat-debug");
const DEFAULT_APP_STARTUP_BUNDLE_LIMIT_KB = 1500;

interface DebugEventPayload {
  readonly sessionId: string;
  readonly sessionKind?: "human" | "webdriver";
  readonly events: unknown[];
}

function readGitBuildInfo(): {
  readonly hash: string;
  readonly time: string;
} {
  try {
    const output = execSync("git log -1 --format=%h%n%cI", { encoding: "utf8" }).trim();
    const [hash = "", time = ""] = output.split("\n");
    return { hash: hash.trim(), time: time.trim() };
  } catch (error: unknown) {
    console.warn("[vite] failed to read git build info", error);
    return { hash: "", time: "" };
  }
}

function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function debugSessionSinkPlugin(): Plugin {
  return {
    name: "coflat-debug-session-sink",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== DEBUG_EVENT_ENDPOINT || req.method !== "POST") {
          next();
          return;
        }

        const chunks: Buffer[] = [];
        req.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        req.on("end", () => {
          try {
            const rawBody = Buffer.concat(chunks).toString("utf8");
            const payload = JSON.parse(rawBody) as DebugEventPayload;
            const sessionId = typeof payload.sessionId === "string"
              ? sanitizeSessionId(payload.sessionId)
              : "unknown";
            const sessionKind = payload.sessionKind === "webdriver" ? "webdriver" : "human";
            const events = Array.isArray(payload.events) ? payload.events : [];
            mkdirSync(DEBUG_EVENT_DIR, { recursive: true });
            const sessionPath = path.join(DEBUG_EVENT_DIR, `${sessionId}.jsonl`);
            if (events.length > 0) {
              const lines = events.map((event) => JSON.stringify(event)).join("\n");
              appendFileSync(sessionPath, `${lines}\n`, "utf8");
            }
            writeFileSync(path.join(DEBUG_EVENT_DIR, "latest-session.json"), JSON.stringify({
              sessionId,
              sessionKind,
              sessionPath,
              updatedAt: new Date().toISOString(),
              eventCount: events.length,
            }, null, 2));
            if (sessionKind === "human") {
              writeFileSync(path.join(DEBUG_EVENT_DIR, "latest-human-session.json"), JSON.stringify({
                sessionId,
                sessionKind,
                sessionPath,
                updatedAt: new Date().toISOString(),
                eventCount: events.length,
              }, null, 2));
            }
            res.statusCode = 204;
            res.end();
          } catch (error: unknown) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
              error: error instanceof Error ? error.message : "invalid debug event payload",
            }));
          }
        });
      });
    },
  };
}

function readAppStartupBundleLimitKb(): number {
  const rawLimit = process.env.COFLAT_APP_STARTUP_BUNDLE_LIMIT_KB;
  if (!rawLimit) {
    return DEFAULT_APP_STARTUP_BUNDLE_LIMIT_KB;
  }
  const parsed = Number(rawLimit);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `[vite] ignoring invalid COFLAT_APP_STARTUP_BUNDLE_LIMIT_KB=${rawLimit}`,
    );
    return DEFAULT_APP_STARTUP_BUNDLE_LIMIT_KB;
  }
  return parsed;
}

function collectStaticChunkNames(
  bundle: OutputBundle,
  names: readonly string[],
): Set<string> {
  const visited = new Set<string>();
  const visit = (name: string) => {
    if (visited.has(name)) return;
    const output = bundle[name];
    if (!output || output.type !== "chunk") return;
    visited.add(name);
    for (const importedName of output.imports) {
      visit(importedName);
    }
  };

  for (const name of names) {
    visit(name);
  }
  return visited;
}

function appStartupBundleBudgetPlugin(limitKb: number): Plugin {
  return {
    name: "coflat-app-startup-bundle-budget",
    apply: "build",
    generateBundle(_options, bundle) {
      const entryNames = Object.entries(bundle)
        .filter(([, output]) => output.type === "chunk" && output.isEntry)
        .map(([name]) => name);
      const startupNames = collectStaticChunkNames(bundle, entryNames);
      let startupBytes = 0;
      for (const name of startupNames) {
        const output = bundle[name];
        if (output?.type === "chunk") {
          startupBytes += Buffer.byteLength(output.code, "utf8");
        }
      }

      const startupKb = startupBytes / 1024;
      const message = `[vite] app startup JS ${startupKb.toFixed(1)} kB (${startupNames.size} chunks, budget ${limitKb} kB)`;
      if (startupKb <= limitKb) {
        console.log(message);
        return;
      }
      if (process.env.COFLAT_APP_BUNDLE_BUDGET_STRICT === "1") {
        this.error(message);
        return;
      }
      console.warn(message);
    },
  };
}

export default defineConfig(({ mode }) => {
  const gitBuildInfo = readGitBuildInfo();
  const linkedNodeModulesRoot = realpathSync(path.join(__dirname, "node_modules"));
  const disableHmr = mode === "show" || process.env.COFLAT_DISABLE_HMR === "1";
  const reactPlugin = react({
    useAtYourOwnRisk_mutateSwcOptions(options) {
      if (mode !== "show") return;
      const reactOptions = options.jsc?.transform?.react;
      if (reactOptions) {
        reactOptions.development = false;
      }
    },
  });
  return {
    plugins: [
      reactPlugin,
      tailwindcss(),
      debugSessionSinkPlugin(),
      appStartupBundleBudgetPlugin(readAppStartupBundleLimitKb()),
      mode === "analyze" &&
        visualizer({
          filename: "dist/app-stats.html",
          open: true,
          gzipSize: true,
          brotliSize: true,
        }),
    ],
    define: {
      GIT_COMMIT_HASH: JSON.stringify(gitBuildInfo.hash),
      GIT_COMMIT_TIME: JSON.stringify(gitBuildInfo.time),
    },
    optimizeDeps: {
      include: [
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "katex",
        "pdfjs-dist",
      ],
    },
    build: {
      target: "es2022",
      sourcemap: mode === "development",
    },
    server: {
      hmr: disableHmr ? false : undefined,
      fs: {
        allow: [__dirname, linkedNodeModulesRoot],
      },
    },
  };
});
