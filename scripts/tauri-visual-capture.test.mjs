import { describe, expect, it } from "vitest";
import { isMacConsoleLocked, parseArgs } from "./tauri-visual-capture.mjs";

describe("tauri visual capture", () => {
  it("detects a locked macOS console from ioreg output", () => {
    expect(isMacConsoleLocked('"IOConsoleLocked" = Yes')).toBe(true);
    expect(isMacConsoleLocked('"CGSSessionScreenIsLocked"=Yes')).toBe(true);
  });

  it("does not report unlocked console output as locked", () => {
    expect(isMacConsoleLocked('"IOConsoleLocked" = No')).toBe(false);
    expect(isMacConsoleLocked('"CGSSessionScreenIsLocked"=No')).toBe(false);
  });

  it("parses capture arguments", () => {
    expect(parseArgs(["--", "--app", "Coflat", "--output", "/tmp/shot.png", "--wait-ms", "50"])).toEqual({
      app: "Coflat",
      output: "/tmp/shot.png",
      waitMs: 50,
    });
  });
});
