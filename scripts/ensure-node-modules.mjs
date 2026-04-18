#!/usr/bin/env node

import process from "node:process";

import { ensureNodeModulesLink } from "./dev-worktree/deps.mjs";

function main() {
  const result = ensureNodeModulesLink();
  if (result.ok) {
    if (result.action === "linked") {
      console.log(`Dependencies: linked ${result.target} -> ${result.source}`);
    } else if (result.action === "repaired") {
      console.log(`Dependencies: repaired ${result.target} -> ${result.source}`);
    }
    return;
  }

  console.error(result.message ?? "Unable to prepare node_modules.");
  process.exit(1);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main();
}
