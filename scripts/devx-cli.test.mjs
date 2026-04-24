import { describe, expect, it } from "vitest";

import { createArgParser, splitCliCommand } from "./devx-cli.mjs";

describe("devx CLI parser", () => {
  it("parses space and equals value flags through one parser", () => {
    const parser = createArgParser([
      "--output=out.tex",
      "--template",
      "article",
      "--timeout",
      "30000",
      "--offset",
      "-4",
      "paper.md",
    ]);

    expect(parser.getFlag("--output")).toBe("out.tex");
    expect(parser.getFlag("--template")).toBe("article");
    expect(parser.getIntFlag("--timeout", 15_000)).toBe(30_000);
    expect(parser.getIntFlag("--offset", 0)).toBe(-4);
    expect(parser.getPositionals()).toEqual(["paper.md"]);
  });

  it("returns integer fallbacks and rejects non-integer values", () => {
    expect(createArgParser([]).getIntFlag("--timeout", 15_000)).toBe(15_000);
    expect(() =>
      createArgParser(["--timeout", "15s"]).getIntFlag("--timeout", 15_000)
    ).toThrow("Invalid integer value for --timeout: 15s");
  });

  it("collects positionals without treating flag values as files", () => {
    expect(
      createArgParser([
        "--url",
        "http://localhost:5174",
        "index.md",
        "--output",
        "/tmp/shot.png",
      ]).getPositionals(),
    ).toEqual(["index.md"]);
    expect(
      createArgParser([
        "index.md",
        "--url",
        "http://localhost:5174",
      ]).getPositionals(),
    ).toEqual(["index.md"]);
  });

  it("reports missing required values using the canonical message", () => {
    const parser = createArgParser(["--base"]);

    expect(() => parser.getRequiredFlag("--base")).toThrow("--base requires a value.");
  });

  it("supports strict script-owned flag validation", () => {
    const parser = createArgParser(["--known", "value", "--unknown"]);

    expect(() => parser.assertKnownFlags(["--known"])).toThrow("Unknown option: --unknown");
  });

  it("does not treat equals-form boolean flags as enabled booleans", () => {
    const parser = createArgParser(["--fetch=false"], {
      booleanFlags: ["--fetch"],
    });

    expect(parser.hasFlag("--fetch")).toBe(false);
    expect(() => parser.assertKnownFlags(["--fetch"])).toThrow(
      "Unknown option: --fetch=false",
    );
  });

  it("can expose a plain flag record for legacy option consumers", () => {
    const parser = createArgParser(["--output=out.tex", "--dump-markdown"]);

    expect(parser.getFlagRecord({ stripPrefix: true })).toEqual({
      output: "out.tex",
      "dump-markdown": true,
    });
  });

  it("keeps command splitting compatible with package-manager separators", () => {
    expect(splitCliCommand(["--", "compare", "--scenario", "open-index"], ["capture", "compare"], "capture")).toEqual({
      command: "compare",
      hasExplicitCommand: true,
      options: ["--scenario", "open-index"],
    });
    expect(splitCliCommand(["--scenario", "open-index"], ["capture", "compare"], "capture")).toEqual({
      command: "capture",
      hasExplicitCommand: false,
      options: ["--scenario", "open-index"],
    });
  });
});
