import { parse as parseYaml, stringify as yamlStringify } from "yaml";

import {
  FRONTMATTER_DELIMITER,
  isFrontmatterDelimiterLine,
} from "../lib/frontmatter-delimiter.js";

/**
 * Move a fenced-div opener's trailing inline title into a `title="..."`
 * attribute. The editor displays `::: {#id .class} My Title` by putting the
 * title text after the attr block; pandoc's `fenced_divs` reader drops that
 * text. Hoisting it into an attribute preserves it as `el.attributes.title`.
 */
const FENCE_WITH_TITLE_RE = /^(:::+)\s*\{([^}]*)\}\s+(\S.*?)\s*$/;

export function liftFencedDivTitles(markdown) {
  const out = [];
  for (const line of markdown.split("\n")) {
    const match = FENCE_WITH_TITLE_RE.exec(line);
    if (!match) {
      out.push(line);
      continue;
    }
    const [, fence, attrs, title] = match;
    const escaped = title.replace(/"/g, '\\"');
    out.push(`${fence} {${attrs} title="${escaped}"}`);
  }
  return out.join("\n");
}

const FRONTMATTER_FENCE = FRONTMATTER_DELIMITER;

/**
 * Rewrite labeled display-math blocks into raw-LaTeX equation environments.
 * Coflat's convention puts the id on the closing fence line:
 *
 *   $$
 *   body
 *   $$ {#eq:foo}
 *
 * Pandoc's tex_math_dollars reader treats the `{#eq:foo}` as plain text and
 * drops the label on the floor. Converting to `\begin{equation}\label{}...
 * \end{equation}` preserves the label and lets \cref{eq:foo} resolve.
 */
export function promoteLabeledDisplayMath(markdown) {
  const lines = markdown.split("\n");
  const out = [];
  let i = 0;
  const openRe = /^\$\$\s*$/;
  const closeWithLabelRe = /^\$\$\s*\{#([A-Za-z][\w:-]*)\}\s*$/;
  while (i < lines.length) {
    if (!openRe.test(lines[i])) {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    let end = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (closeWithLabelRe.test(lines[j]) || openRe.test(lines[j])) {
        end = j;
        break;
      }
    }
    if (end === -1) {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    const closer = closeWithLabelRe.exec(lines[end]);
    if (!closer) {
      for (let j = i; j <= end; j += 1) out.push(lines[j]);
      i = end + 1;
      continue;
    }
    const id = closer[1];
    const body = lines.slice(i + 1, end).join("\n");
    out.push(`\\begin{equation}\\label{${id}}`);
    out.push(body);
    out.push("\\end{equation}");
    i = end + 1;
  }
  return out.join("\n");
}

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
 * Full pre-pandoc pipeline: hoist math macros, promote labeled display math,
 * then lift fenced-div titles. The root frontmatter is preserved (minus
 * `math:`, which is rewritten into `header-includes`) so pandoc reads it as
 * metadata.
 */
export async function preprocessWithReadFile(markdown) {
  const withMacros = hoistMathMacros(markdown);
  const withEquations = promoteLabeledDisplayMath(withMacros);
  return liftFencedDivTitles(withEquations);
}
