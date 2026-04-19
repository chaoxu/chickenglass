#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tauriConfigPath = join(repoRoot, "src-tauri", "tauri.conf.json");
const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
const appName = tauriConfig.productName;
const bundleIdentifier = tauriConfig.identifier;
const builtAppPath = join(
  repoRoot,
  "src-tauri",
  "target",
  "release",
  "bundle",
  "macos",
  `${appName}.app`,
);
const installedAppPath = `/Applications/${appName}.app`;
const lsregisterPath =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

function run(name, command, args, options = {}) {
  console.log(`[install-macos-app] ${name}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "inherit",
    ...options,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${name} failed with exit code ${result.status ?? "unknown"}.`);
  }
}

function tryQuitInstalledApp() {
  if (!bundleIdentifier) {
    return;
  }

  spawnSync(
    "osascript",
    [
      "-e",
      `if application id "${bundleIdentifier}" is running then tell application id "${bundleIdentifier}" to quit`,
    ],
    {
      encoding: "utf8",
      stdio: "ignore",
    },
  );
}

function main() {
  if (process.platform !== "darwin") {
    throw new Error("macOS app installation is only supported on darwin.");
  }
  if (!appName) {
    throw new Error(`Missing productName in ${tauriConfigPath}.`);
  }

  run("build Tauri app", "pnpm", ["tauri:build"]);

  if (!existsSync(builtAppPath)) {
    throw new Error(`Expected built app at ${builtAppPath}.`);
  }

  run("ad-hoc sign built app", "codesign", ["--force", "--deep", "--sign", "-", builtAppPath]);
  run("verify built app signature", "codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    builtAppPath,
  ]);

  tryQuitInstalledApp();
  rmSync(installedAppPath, { force: true, recursive: true });
  run("copy app to /Applications", "ditto", [builtAppPath, installedAppPath]);
  run("verify installed app signature", "codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    installedAppPath,
  ]);
  run("register installed app", lsregisterPath, ["-f", installedAppPath]);

  console.log(`[install-macos-app] installed ${installedAppPath}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
