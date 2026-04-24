import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

interface PackageJson {
  readonly name: string;
  readonly scripts: Record<string, string>;
}

interface TauriConfig {
  readonly productName: string;
  readonly identifier: string;
}

interface TauriCapabilities {
  readonly windows: readonly string[];
  readonly permissions: readonly string[];
}

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readRepoFile(relativePath)) as T;
}

function readHtmlTitle(): string | null {
  const html = readRepoFile("index.html");
  return html.match(/<title>([^<]+)<\/title>/)?.[1] ?? null;
}

describe("product metadata", () => {
  it("uses the Coflat desktop identity across package, Tauri, and HTML metadata", () => {
    const pkg = readJson<PackageJson>("package.json");
    const tauri = readJson<TauriConfig>("src-tauri/tauri.conf.json");

    expect(pkg.name).toBe("coflat");
    expect(tauri.productName).toBe("Coflat");
    expect(tauri.identifier).toBe("com.coflats.desktop");
    expect(readHtmlTitle()).toBe("Coflat");
  });

  it("grants spawned document windows the required native capabilities", () => {
    const capabilities = readJson<TauriCapabilities>(
      "src-tauri/capabilities/default.json",
    );

    expect(capabilities.windows).toEqual(expect.arrayContaining([
      "main",
      "document-*",
    ]));
    expect(capabilities.permissions).toEqual(expect.arrayContaining([
      "core:window:allow-create",
      "core:window:allow-set-focus",
      "core:webview:allow-create-webview-window",
    ]));
  });

  it("keeps browser launcher roles explicit in package scripts", () => {
    const pkg = readJson<PackageJson>("package.json");

    expect(pkg.scripts.chrome).toBe("pnpm chrome:app --");
    expect(pkg.scripts["chrome:app"]).toBe("node scripts/launch-chrome.mjs --activate");
    expect(pkg.scripts["chrome:cdp"]).toBe("node scripts/launch-chrome.mjs --no-activate");
  });
});
