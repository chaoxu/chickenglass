import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEBUG_BRIDGE_DOC_ENTRIES,
  DEBUG_BRIDGE_READY_PROMISES,
  DEBUG_BRIDGE_REQUIRED_GLOBAL_NAMES,
  formatDebugBridgeDocs,
} from "../src/debug/debug-bridge-contract.js";

describe("debug bridge contract", () => {
  it("centralizes the required browser globals and readiness promises", () => {
    expect(DEBUG_BRIDGE_REQUIRED_GLOBAL_NAMES).toEqual(["__app", "__editor", "__cfDebug"]);
    expect(DEBUG_BRIDGE_READY_PROMISES.map((entry) => `${entry.globalName}.${entry.propertyName}`)).toEqual([
      "__app.ready",
      "__editor.ready",
      "__cfDebug.ready",
    ]);
  });

  it("keeps the AGENTS debug-helper block derived from the canonical contract", () => {
    const agents = readFileSync(resolve("AGENTS.md"), "utf8");
    const block = agents.match(/Debug globals are exposed[\s\S]*?```\n([\s\S]*?)\n```/u);

    expect(block?.[1]).toBe(formatDebugBridgeDocs(DEBUG_BRIDGE_DOC_ENTRIES));
  });
});

