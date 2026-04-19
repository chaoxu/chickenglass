import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = resolve(SCRIPT_DIR, "..");
export const REPO_DEMO_ROOT = resolve(REPO_ROOT, "demo");
export const REPO_FIXTURE_ROOT = resolve(REPO_ROOT, "fixtures");

export const TOOLING_FIXTURES = {
  publicShowcase: {
    candidates: [resolve(REPO_ROOT, "demo/index.md")],
    displayPath: "demo/index.md",
    fallback: null,
    key: "publicShowcase",
    privacy: "public",
    purpose: "public showcase fallback",
    virtualPath: "index.md",
  },
  rankdecrease: {
    candidates: [resolve(REPO_ROOT, "fixtures/rankdecrease/main.md")],
    displayPath: "fixtures/rankdecrease/main.md",
    fallback: "publicShowcase",
    key: "rankdecrease",
    privacy: "local",
    purpose: "preferred heavy scroll/perf fixture",
    virtualPath: "rankdecrease/main.md",
  },
  cogirthMain2: {
    candidates: [resolve(REPO_ROOT, "fixtures/cogirth/main2.md")],
    displayPath: "fixtures/cogirth/main2.md",
    fallback: "publicShowcase",
    key: "cogirthMain2",
    privacy: "local",
    purpose: "typing/perf semantic hotspots",
    virtualPath: "cogirth/main2.md",
  },
  cogirthIncludeLabels: {
    candidates: [resolve(REPO_ROOT, "fixtures/cogirth/include-labels.md")],
    displayPath: "fixtures/cogirth/include-labels.md",
    fallback: null,
    key: "cogirthIncludeLabels",
    privacy: "local",
    purpose: "include composition browser regression",
    virtualPath: "cogirth/include-labels.md",
  },
  cogirthSearchModeAwareness: {
    candidates: [resolve(REPO_ROOT, "fixtures/cogirth/search-mode-awareness.md")],
    displayPath: "fixtures/cogirth/search-mode-awareness.md",
    fallback: null,
    key: "cogirthSearchModeAwareness",
    privacy: "local",
    purpose: "search mode browser regression",
    virtualPath: "cogirth/search-mode-awareness.md",
  },
};

export function fixtureForHarness(key) {
  const fixture = TOOLING_FIXTURES[key];
  if (!fixture) {
    throw new Error(`Unknown tooling fixture: ${key}`);
  }
  return {
    candidates: fixture.candidates,
    displayPath: fixture.displayPath,
    virtualPath: fixture.virtualPath,
  };
}

export function fallbackFixtureFor(key) {
  const fixture = TOOLING_FIXTURES[key];
  return fixture?.fallback ? fixtureForHarness(fixture.fallback) : null;
}

export function fixtureCandidatesText(key) {
  return TOOLING_FIXTURES[key]?.candidates.join(", ") ?? "<unknown fixture>";
}

export function fixtureCoverageWarning(key, fallbackKey) {
  const fixture = TOOLING_FIXTURES[key];
  const fallback = TOOLING_FIXTURES[fallbackKey];
  if (!fixture || !fallback) {
    throw new Error(`Unknown fixture coverage pair: ${key} -> ${fallbackKey}`);
  }
  return `Missing ${fixture.purpose} ${fixture.displayPath}; using ${fallback.displayPath}. Tried: ${fixtureCandidatesText(key)}.`;
}

export function fixtureStatus(key) {
  const fixture = TOOLING_FIXTURES[key];
  if (!fixture) {
    throw new Error(`Unknown tooling fixture: ${key}`);
  }
  const present = fixture.candidates.some((candidate) => existsSync(candidate));
  const fallback = fixture.fallback ? TOOLING_FIXTURES[fixture.fallback] : null;
  return {
    fallback: fallback?.displayPath ?? "inline public fallback",
    path: fixture.displayPath,
    privacy: fixture.privacy,
    purpose: fixture.purpose,
    status: present ? "present" : `missing; fallback: ${fallback?.displayPath ?? "inline public fallback"}`,
  };
}

