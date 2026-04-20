import { parse as parseYaml, stringify as yamlStringify } from "yaml";

import {
  FRONTMATTER_DELIMITER,
  isFrontmatterDelimiterLine,
} from "../lib/frontmatter-delimiter.js";

const FRONTMATTER_FENCE = FRONTMATTER_DELIMITER;

function countMacroArgs(body) {
  let max = 0;
  const re = /#(\d)/g;
  let match;
  while ((match = re.exec(body)) !== null) {
    const n = Number(match[1]);
    if (n > max) max = n;
  }
  return max;
}

export function renderMathMacros(math) {
  const names = Object.keys(math).sort();
  const lines = [];
  for (const rawName of names) {
    const body = math[rawName];
    if (typeof body !== "string") continue;
    const cleanName = rawName.replace(/^\\+/, "");
    const nargs = countMacroArgs(body);
    const sig = nargs > 0 ? `[${nargs}]` : "";
    lines.push(`\\newcommand{\\${cleanName}}${sig}{${body}}`);
  }
  return lines.join("\n");
}

/**
 * Hoist `math:` frontmatter into a `header-includes` raw-LaTeX block,
 * bypassing pandoc's inline YAML parser (which re-parses the macro body
 * and mangles commands like `\rho` or `\operatorname`). The YAML we write
 * back out preserves everything else verbatim.
 */
export function hoistMathMacros(markdown) {
  const lines = markdown.split("\n");
  if (!isFrontmatterDelimiterLine(lines[0] ?? "")) return markdown;
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (isFrontmatterDelimiterLine(lines[i])) {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) return markdown;
  const raw = lines.slice(1, closeIdx).join("\n");
  let doc;
  try {
    doc = parseYaml(raw);
  } catch {
    return markdown;
  }
  if (!doc || typeof doc !== "object" || !doc.math || typeof doc.math !== "object") {
    return markdown;
  }
  const preamble = renderMathMacros(doc.math);
  delete doc.math;

  const existing = doc["header-includes"];
  const chunks = [];
  if (typeof existing === "string") chunks.push(existing);
  else if (Array.isArray(existing)) chunks.push(...existing.filter((x) => typeof x === "string"));
  chunks.push(preamble);
  doc["header-includes"] = chunks.join("\n");

  const newYaml = yamlStringify(doc).trimEnd();
  const rest = lines.slice(closeIdx + 1).join("\n");
  return `${FRONTMATTER_FENCE}\n${newYaml}\n${FRONTMATTER_FENCE}\n${rest}`;
}

/**
 * Full pre-pandoc pipeline for canonical Coflat Markdown. The root
 * frontmatter is preserved (minus `math:`, which is rewritten into
 * `header-includes`) so Pandoc reads it as metadata.
 *
 * @param {string} markdown
 * @param {string} [_sourcePath]
 * @param {unknown} [_options]
 * @returns {Promise<string>}
 */
export async function preprocessWithReadFile(markdown, _sourcePath, _options) {
  return hoistMathMacros(markdown);
}
