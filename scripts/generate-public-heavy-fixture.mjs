#!/usr/bin/env node

import console from "node:console";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const DEFAULT_SOURCE = resolve(REPO_ROOT, "fixtures/rankdecrease/main.md");
const DEFAULT_BIB = resolve(REPO_ROOT, "fixtures/rankdecrease/ref.bib");
const OUT_DIR = resolve(REPO_ROOT, "demo/perf-heavy");

const PRESERVED_CLASSES = new Set([
  "algorithm",
  "axiom",
  "claim",
  "conjecture",
  "corollary",
  "definition",
  "example",
  "exercise",
  "figure",
  "lemma",
  "problem",
  "proof",
  "proposition",
  "remark",
  "table",
  "theorem",
]);

const LOCAL_LABEL_PREFIXES = new Set([
  "alg",
  "axiom",
  "claim",
  "conj",
  "cor",
  "def",
  "eq",
  "ex",
  "fig",
  "lem",
  "prob",
  "prop",
  "rem",
  "sec",
  "tbl",
  "thm",
]);

function parseArgs(argv) {
  const args = {
    source: DEFAULT_SOURCE,
    bib: DEFAULT_BIB,
    outDir: OUT_DIR,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source") {
      args.source = resolve(argv[++index] ?? "");
      continue;
    }
    if (arg === "--bib") {
      args.bib = resolve(argv[++index] ?? "");
      continue;
    }
    if (arg === "--out-dir") {
      args.outDir = resolve(argv[++index] ?? "");
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return args;
}

function printUsage() {
  console.log(`Usage:
  node scripts/generate-public-heavy-fixture.mjs [options]

Options:
  --source <path>   Private markdown source to redact
  --bib <path>      Private BibTeX source to redact
  --out-dir <path>  Output directory (default: demo/perf-heavy)
  -h, --help        Show this help text
`);
}

function ensureInput(path, label) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${label}: ${path}`);
  }
}

function pad(value) {
  return String(value).padStart(4, "0");
}

function createMapper(prefix, separator = "") {
  const values = new Map();
  return (key) => {
    if (!values.has(key)) {
      values.set(key, `${prefix}${separator}${pad(values.size + 1)}`);
    }
    return values.get(key);
  };
}

function labelPrefix(key) {
  const match = /^([A-Za-z][A-Za-z0-9_-]*):/.exec(key);
  if (!match) {
    return null;
  }
  return LOCAL_LABEL_PREFIXES.has(match[1]) ? match[1] : null;
}

function collectBibKeys(text) {
  return [...text.matchAll(/@\s*[A-Za-z][A-Za-z0-9_-]*\s*\{\s*([^,\s]+)\s*,/g)]
    .map((match) => match[1]);
}

function collectMarkdownIds(text) {
  return [...text.matchAll(/\{[^}\n]*#([A-Za-z0-9_:./-]+)[^}\n]*\}/g)]
    .map((match) => match[1]);
}

function collectAtKeys(text) {
  return [...text.matchAll(/@([A-Za-z0-9_:./-]+)/g)]
    .map((match) => match[1]);
}

export function createRedactionContext(markdown, bib) {
  const bibKeys = collectBibKeys(bib);
  const bibKeySet = new Set(bibKeys);
  const citationFor = createMapper("cite");
  const genericIdFor = createMapper("id", ":public-");
  const labelCounters = new Map();
  const labelMaps = new Map();
  const citationMap = new Map();
  const idMap = new Map();

  const mapId = (key) => {
    if (idMap.has(key)) {
      return idMap.get(key);
    }
    const prefix = labelPrefix(key);
    if (!prefix) {
      const mapped = genericIdFor(key);
      idMap.set(key, mapped);
      return mapped;
    }
    if (!labelMaps.has(prefix)) {
      labelCounters.set(prefix, 0);
      labelMaps.set(prefix, new Map());
    }
    const prefixMap = labelMaps.get(prefix);
    if (!prefixMap.has(key)) {
      const next = (labelCounters.get(prefix) ?? 0) + 1;
      labelCounters.set(prefix, next);
      prefixMap.set(key, `${prefix}:public-${pad(next)}`);
    }
    const mapped = prefixMap.get(key);
    idMap.set(key, mapped);
    return mapped;
  };

  const mapCitation = (key) => {
    if (labelPrefix(key)) {
      return mapId(key);
    }
    if (!citationMap.has(key)) {
      citationMap.set(key, citationFor(key));
    }
    return citationMap.get(key);
  };

  for (const key of bibKeys) {
    citationMap.set(key, citationFor(key));
  }
  for (const key of collectMarkdownIds(markdown)) {
    mapId(key);
  }
  for (const key of collectAtKeys(markdown)) {
    if (bibKeySet.has(key) || !labelPrefix(key)) {
      mapCitation(key);
    } else {
      mapId(key);
    }
  }

  return {
    citationMap,
    idMap,
    mapCitation,
    mapId,
  };
}

function redactCharacters(text) {
  return text
    .replace(/\p{L}/gu, "x")
    .replace(/\p{N}/gu, "0");
}

function withPlaceholders(callback) {
  const placeholders = [];
  const protect = (value) => {
    const marker = `\u0000${String.fromCodePoint(0xe000 + placeholders.length)}\u0000`;
    placeholders.push([marker, value]);
    return marker;
  };
  const restore = (value) => {
    let restored = value;
    for (const [marker, replacement] of placeholders) {
      restored = restored.split(marker).join(replacement);
    }
    return restored;
  };

  return callback(protect, restore);
}

function redactUnknownClass(className) {
  return redactCharacters(className);
}

function redactAttributeBlock(attributeText, context) {
  const protectedAttribute = attributeText.replace(
    /([#.])([A-Za-z0-9_:./-]+)/g,
    (match, sigil, value) => {
      if (sigil === "#") {
        return `#${context.mapId(value)}`;
      }
      if (PRESERVED_CLASSES.has(value)) {
        return `.${value}`;
      }
      return `.${redactUnknownClass(value)}`;
    },
  );
  return protectedAttribute.replace(
    /([A-Za-z_:][A-Za-z0-9_:.-]*)(\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s}]+))/g,
    (match, name, separator, doubleQuoted, singleQuoted, bare) => {
      const value = doubleQuoted ?? singleQuoted ?? bare ?? "";
      const quote = doubleQuoted !== undefined ? "\"" : singleQuoted !== undefined ? "'" : "";
      const redactedValue = redactCharacters(value);
      return `${name}${separator}${quote}${redactedValue}${quote}`;
    },
  );
}

function redactOutsideMath(text, context) {
  return withPlaceholders((protect, restore) => {
    const protectedText = text
      .replace(/\{[^}\n]*(?:#[A-Za-z0-9_:./-]+|\.[A-Za-z0-9_-]+)[^}\n]*\}/g, (match) =>
        protect(redactAttributeBlock(match, context)),
      )
      .replace(/@([A-Za-z0-9_:./-]+)/g, (match, key) =>
        protect(`@${context.mapCitation(key)}`),
      );

    return restore(redactCharacters(protectedText));
  });
}

function findNextUnescaped(line, token, fromIndex) {
  let index = fromIndex;
  while (index < line.length) {
    const next = line.indexOf(token, index);
    if (next === -1) {
      return -1;
    }
    if (line[next - 1] !== "\\") {
      return next;
    }
    index = next + token.length;
  }
  return -1;
}

function startsInlineMath(line, index) {
  if (line[index] !== "$" || line[index - 1] === "\\" || line[index + 1] === "$") {
    return false;
  }
  return findNextUnescaped(line, "$", index + 1) !== -1;
}

function redactMarkdownLine(line, context, state) {
  let index = 0;
  let output = "";

  while (index < line.length) {
    if (state.math === "dollar") {
      const close = findNextUnescaped(line, "$$", index);
      if (close === -1) {
        output += line.slice(index);
        return output;
      }
      output += line.slice(index, close + 2);
      index = close + 2;
      state.math = null;
      continue;
    }

    if (state.math === "bracket") {
      const close = findNextUnescaped(line, "\\]", index);
      if (close === -1) {
        output += line.slice(index);
        return output;
      }
      output += line.slice(index, close + 2);
      index = close + 2;
      state.math = null;
      continue;
    }

    if (line.startsWith("$$", index)) {
      output += "$$";
      index += 2;
      state.math = "dollar";
      continue;
    }

    if (line.startsWith("\\[", index)) {
      output += "\\[";
      index += 2;
      state.math = "bracket";
      continue;
    }

    if (startsInlineMath(line, index)) {
      const close = findNextUnescaped(line, "$", index + 1);
      output += line.slice(index, close + 1);
      index = close + 1;
      continue;
    }

    const nextDollarDisplay = line.indexOf("$$", index);
    const nextBracketDisplay = line.indexOf("\\[", index);
    const nextInlineMath = (() => {
      for (let cursor = index; cursor < line.length; cursor += 1) {
        if (startsInlineMath(line, cursor)) {
          return cursor;
        }
      }
      return -1;
    })();
    const nextSpecial = [nextDollarDisplay, nextBracketDisplay, nextInlineMath]
      .filter((value) => value >= 0)
      .sort((a, b) => a - b)[0] ?? line.length;

    output += redactOutsideMath(line.slice(index, nextSpecial), context);
    index = nextSpecial;
  }

  return output;
}

function redactFrontmatterLine(line, state) {
  if (line === "---") {
    return line;
  }
  const topLevelKey = /^([A-Za-z0-9_-]+)\s*:/.exec(line);
  if (topLevelKey) {
    state.frontmatterKey = topLevelKey[1];
  }
  const bibliography = /^(\s*bibliography\s*:\s*).*/.exec(line);
  if (bibliography) {
    return `${bibliography[1]}refs.bib`;
  }
  if (
    state.frontmatterKey === "blocks" ||
    state.frontmatterKey === "math" ||
    state.frontmatterKey === "numbering"
  ) {
    return line;
  }
  const keyValue = /^(\s*[A-Za-z0-9_-]+\s*:\s*)(.*)$/.exec(line);
  if (keyValue) {
    return `${keyValue[1]}${redactCharacters(keyValue[2])}`;
  }
  return redactCharacters(line);
}

export function redactMarkdown(markdown, context) {
  const lines = markdown.split("\n");
  const state = {
    frontmatter: lines[0] === "---",
    frontmatterClosed: lines[0] !== "---",
    frontmatterKey: null,
    math: null,
  };

  const redacted = lines.map((line, index) => {
    if (state.frontmatter && !state.frontmatterClosed) {
      if (index > 0 && line === "---") {
        state.frontmatterClosed = true;
        return line;
      }
      return redactFrontmatterLine(line, state);
    }
    return redactMarkdownLine(line, context, state);
  });

  const header = "<!-- Generated by scripts/generate-public-heavy-fixture.mjs from a private fixture. Non-math prose is redacted; citations and labels are remapped. -->";
  const insertAt = lines[0] === "---"
    ? redacted.findIndex((line, index) => index > 0 && line === "---") + 1
    : 0;
  if (insertAt > 0) {
    redacted.splice(insertAt, 0, "", header);
  } else {
    redacted.unshift(header, "");
  }
  return redacted.join("\n");
}

export function redactBibtex(text, context) {
  return withPlaceholders((protect, restore) => {
    const protectedText = text
      .replace(
        /(@\s*[A-Za-z][A-Za-z0-9_-]*\s*\{\s*)([^,\s]+)(\s*,)/g,
        (match, prefix, key, suffix) => protect(`${prefix}${context.mapCitation(key)}${suffix}`),
      )
      .replace(
        /^(\s*)([A-Za-z][A-Za-z0-9_-]*)(\s*=)/gm,
        (match, indent, field, suffix) => protect(`${indent}${field}${suffix}`),
      );

    return restore(redactCharacters(protectedText));
  });
}

export function writePublicFixture({ source, bib, outDir }) {
  ensureInput(source, "markdown source");
  ensureInput(bib, "BibTeX source");

  const markdown = readFileSync(source, "utf8");
  const bibtex = readFileSync(bib, "utf8");
  const context = createRedactionContext(markdown, bibtex);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "main.md"), redactMarkdown(markdown, context), "utf8");
  writeFileSync(resolve(outDir, "refs.bib"), redactBibtex(bibtex, context), "utf8");

  return {
    bibKeys: context.citationMap.size,
    labels: context.idMap.size,
    outDir,
  };
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printUsage();
    return;
  }
  const result = writePublicFixture(args);
  console.log(`Wrote public heavy fixture to ${result.outDir}`);
  console.log(`Remapped ${result.bibKeys} citation keys and ${result.labels} labels.`);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
