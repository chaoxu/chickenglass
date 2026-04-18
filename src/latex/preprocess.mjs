import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";

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

const INCLUDE_OPEN_RE = /^(:::+)\s*\{([^}]*\binclude\b[^}]*)\}\s*$/;
const FRONTMATTER_OPEN_RE = /^---\s*$/;

function stripFrontmatter(source) {
  if (!FRONTMATTER_OPEN_RE.test(source.split("\n", 1)[0] ?? "")) return source;
  const lines = source.split("\n");
  for (let i = 1; i < lines.length; i += 1) {
    if (FRONTMATTER_OPEN_RE.test(lines[i])) {
      return lines.slice(i + 1).join("\n");
    }
  }
  return source;
}

/**
 * Splice every `::: {.include}` block with the referenced file's body.
 * Paths resolve relative to the file containing the include. Nested
 * includes are followed transitively; cycles throw.
 */
export async function resolveIncludes(markdown, sourcePath) {
  const seen = new Set([resolve(sourcePath)]);
  return splice(markdown, sourcePath, seen);
}

async function splice(markdown, sourcePath, seen) {
  const lines = markdown.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const match = INCLUDE_OPEN_RE.exec(lines[i]);
    if (!match) {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    const fence = match[1];
    let closeIdx = -1;
    let target = null;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (lines[j].startsWith(fence) && lines[j].slice(fence.length).trim() === "") {
        closeIdx = j;
        break;
      }
      const trimmed = lines[j].trim();
      if (trimmed && target === null) target = trimmed;
    }
    if (closeIdx === -1 || target === null) {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    const absolute = resolve(dirname(sourcePath), target);
    if (seen.has(absolute)) {
      throw new Error(`Include cycle detected at ${absolute}`);
    }
    const next = new Set(seen).add(absolute);
    const raw = await readFile(absolute, "utf8");
    const stripped = stripFrontmatter(raw);
    const spliced = await splice(stripped, absolute, next);
    out.push(spliced);
    i = closeIdx + 1;
  }
  return out.join("\n");
}

const FRONTMATTER_FENCE = "---";

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
  if (lines[0] !== FRONTMATTER_FENCE) return markdown;
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === FRONTMATTER_FENCE) {
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
 * Full pre-pandoc pipeline: resolve includes, hoist math macros, then lift
 * fenced-div titles. The root frontmatter is preserved (minus `math:`, which
 * is rewritten into `header-includes`) so pandoc reads it as metadata.
 */
export async function preprocess(markdown, sourcePath) {
  const withIncludes = await resolveIncludes(markdown, sourcePath);
  const withMacros = hoistMathMacros(withIncludes);
  const withEquations = promoteLabeledDisplayMath(withMacros);
  return liftFencedDivTitles(withEquations);
}
