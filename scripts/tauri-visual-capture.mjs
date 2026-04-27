#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MIN_SCREENSHOT_BYTES = 256 * 1024;

export function isMacConsoleLocked(ioregOutput) {
  return /"IOConsoleLocked"\s*=\s*Yes/.test(ioregOutput)
    || /"CGSSessionScreenIsLocked"\s*=\s*Yes/.test(ioregOutput);
}

export function parseArgs(argv) {
  const args = {
    app: "Coflat",
    output: join(tmpdir(), `coflat-tauri-visual-${Date.now()}.png`),
    waitMs: 4000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--app") {
      args.app = argv[index + 1] ?? args.app;
      index += 1;
    } else if (arg === "--output") {
      args.output = argv[index + 1] ?? args.output;
      index += 1;
    } else if (arg === "--wait-ms") {
      const value = Number(argv[index + 1]);
      if (Number.isFinite(value) && value >= 0) {
        args.waitMs = value;
      }
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function usage() {
  return [
    "Usage: node scripts/tauri-visual-capture.mjs [--app Coflat] [--output /tmp/shot.png] [--wait-ms 4000]",
    "",
    "Captures the visible macOS Tauri app for human visual inspection.",
    "Fails before capture if the console session is locked, because that produces black or lock-screen screenshots.",
  ].join("\n");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
  });
  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || "").trim();
    throw new Error(`${command} ${args.join(" ")} failed${details ? `: ${details}` : ""}`);
  }
  return result.stdout;
}

function readConsoleState() {
  return execFileSync("ioreg", ["-n", "Root", "-d1"], { encoding: "utf8" });
}

export function validateScreenshotFile(path) {
  if (!existsSync(path)) {
    throw new Error(`Screenshot was not created: ${path}`);
  }
  const size = statSync(path).size;
  if (size < MIN_SCREENSHOT_BYTES) {
    throw new Error(
      `Screenshot looks empty (${size} bytes). The display may still be blank or inaccessible.`,
    );
  }
  return size;
}

export function captureTauriVisual({ app, output, waitMs }) {
  if (process.platform !== "darwin") {
    throw new Error("Tauri visual capture currently supports macOS only.");
  }

  const consoleState = readConsoleState();
  if (isMacConsoleLocked(consoleState)) {
    throw new Error(
      [
        "macOS console is locked, so screenshots capture the lock screen or a black frame.",
        "Unlock the Mac in the active GUI session, then rerun this command.",
      ].join(" "),
    );
  }

  run("caffeinate", ["-u", "-t", "5"]);
  run("open", ["-a", app]);
  if (waitMs > 0) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
  }
  run("screencapture", ["-x", "-tpng", output]);
  return {
    output,
    bytes: validateScreenshotFile(output),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      process.exit(0);
    }
    const result = captureTauriVisual(args);
    console.log(`${result.output} (${result.bytes} bytes)`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
