#!/usr/bin/env node

import console from "node:console";
import process from "node:process";
import {
  activateChromeApp,
  ensureProfileDir,
  launchChromeApp,
  parseChromeArgs,
  resolveChromeAppBundle,
  resolveChromeBinary,
  reuseChromeApp,
  waitForChrome,
} from "./chrome-common.mjs";
import { ensureAppServer } from "./browser-lifecycle.mjs";

export async function openChromeApp(args) {
  const binary = resolveChromeBinary();
  const appBundle = resolveChromeAppBundle(binary);
  const profileDir = ensureProfileDir(args.profileDir);

  const reused = await reuseChromeApp(args.port, args.url);
  if (reused) {
    if (args.activate) {
      activateChromeApp(appBundle);
    }
    return {
      profileDir,
      ready: true,
      reused: true,
    };
  }

  const pid = launchChromeApp(binary, args);
  const ready = await waitForChrome(args.port);
  if (args.activate) {
    activateChromeApp(appBundle);
  }

  return {
    pid,
    profileDir,
    ready,
    reused: false,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseChromeArgs(argv, { activate: true });
  const stopAppServer = await ensureAppServer(args.url);
  const chrome = await openChromeApp(args);

  console.log(`${chrome.reused ? "Reused" : "Launched"} Chrome for Testing app: ${args.url}`);
  console.log(`CDP on ws://localhost:${args.port}`);
  console.log(`Profile: ${chrome.profileDir}`);
  if (chrome.pid !== undefined && chrome.pid !== null) {
    console.log(`PID: ${chrome.pid}`);
  }
  if (!chrome.ready) {
    console.log("Warning: Chrome launched, but CDP was not reachable yet.");
  }

  if (!stopAppServer) {
    return;
  }

  let shuttingDown = false;
  const cleanup = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await stopAppServer();
  };

  process.once("SIGINT", () => {
    cleanup().finally(() => process.exit(130));
  });
  process.once("SIGTERM", () => {
    cleanup().finally(() => process.exit(143));
  });

  await new Promise(() => {});
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
}

