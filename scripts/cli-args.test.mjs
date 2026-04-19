import { describe, expect, it } from "vitest";

import { createArgParser, splitCommand } from "./cli-args.mjs";

describe("cli args", () => {
  it("parses --flag value and --flag=value forms", () => {
    const parser = createArgParser([
      "--url",
      "http://localhost:5173",
      "--port=9322",
      "--headed",
    ]);

    expect(parser.getFlag("--url")).toBe("http://localhost:5173");
    expect(parser.getIntFlag("--port", 0)).toBe(9322);
    expect(parser.hasFlag("--headed")).toBe(true);
    expect(parser.hasFlag("--missing")).toBe(false);
  });

  it("collects positionals while skipping configured flag values", () => {
    const parser = createArgParser([
      "name",
      "--template",
      "basic",
      "--output=/tmp/out",
      "extra",
    ]);

    expect(parser.positionals({ valueFlags: ["--template"] })).toEqual(["name", "extra"]);
  });

  it("forwards only present valued flags", () => {
    const parser = createArgParser([
      "--iterations=3",
      "--warmup",
      "1",
      "--headed",
    ]);
    const target = ["script.mjs"];

    expect(parser.forwardFlags(target, ["--iterations", "--warmup", "--missing"])).toEqual([
      "script.mjs",
      "--iterations",
      "3",
      "--warmup",
      "1",
    ]);
  });

  it("splits known commands from options", () => {
    expect(splitCommand(["check", "--scenario", "typing"], ["baseline", "check"], "baseline")).toEqual({
      command: "check",
      options: ["--scenario", "typing"],
    });
    expect(splitCommand(["--scenario", "typing"], ["baseline", "check"], "baseline")).toEqual({
      command: "baseline",
      options: ["--scenario", "typing"],
    });
  });
});

