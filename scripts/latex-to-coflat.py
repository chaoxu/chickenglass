#!/usr/bin/env python3
"""Convert article-style LaTeX into Coflat-flavored markdown.

This is a best-effort importer for papers that are already mostly plain text
and theorem/proof style math writing. The workflow is:

1. Run Pandoc with `--wrap=none` to get an unwrapped markdown scaffold.
2. Extract metadata from the TeX preamble (title, authors, abstract, etc.).
3. Rewrite Pandoc's theorem/proof/reference output into Coflat's fenced-div
   conventions.
4. Rebuild figure and algorithm blocks from the original TeX when Pandoc loses
   fidelity.

Usage:
  python3 scripts/latex-to-coflat.py input.tex output.md
  python3 scripts/latex-to-coflat.py input.tex output.md --copy-bibliography --copy-assets
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
BLOCK_MANIFEST_TS = REPO_ROOT / "src" / "constants" / "block-manifest.ts"
GRAPHICS_EXTENSIONS = (".pdf", ".png", ".jpg", ".jpeg", ".svg", ".eps")
INLINE_REPLACEMENTS = (
    ("\\gets", " <- "),
    ("\\cup", " union "),
    ("\\leq", "<="),
    ("\\geq", ">="),
    ("\\infty", "infty"),
    ("\\in", " in "),
    ("\\mathcal{C}", "C"),
    ("\\mathbb{R}", "R"),
    ("\\operatorname{supp}", "supp"),
    ("\\supp", "supp"),
    ("\\|", "||"),
)


@dataclass(frozen=True)
class BlockManifestEntry:
    name: str
    numbered: bool
    special_behavior: str | None = None


def load_block_manifest_entries(path: Path = BLOCK_MANIFEST_TS) -> tuple[BlockManifestEntry, ...]:
    source = path.read_text()
    manifest_match = re.search(r"export const BLOCK_MANIFEST = \[([\s\S]*?)\] as const", source)
    if not manifest_match:
        raise RuntimeError(f"Cannot find BLOCK_MANIFEST in {path}")

    entries: list[BlockManifestEntry] = []
    for entry_match in re.finditer(r"\{([^{}]+)\}", manifest_match.group(1)):
        raw_entry = entry_match.group(1)
        name_match = re.search(r'name:\s*"([^"]+)"', raw_entry)
        if not name_match:
            continue
        numbered_match = re.search(r"numbered:\s*(true|false)", raw_entry)
        special_match = re.search(r'specialBehavior:\s*"([^"]+)"', raw_entry)
        entries.append(
            BlockManifestEntry(
                name=name_match.group(1),
                numbered=numbered_match.group(1) == "true" if numbered_match else False,
                special_behavior=special_match.group(1) if special_match else None,
            )
        )

    if not entries:
        raise RuntimeError(f"BLOCK_MANIFEST in {path} did not contain parseable entries")
    return tuple(entries)


def latex_rewrite_block_classes(
    entries: tuple[BlockManifestEntry, ...] = load_block_manifest_entries(),
) -> tuple[str, ...]:
    excluded = {"figure", "table"}
    return tuple(
        entry.name
        for entry in entries
        if entry.name not in excluded and entry.special_behavior not in {"embed", "blockquote", "include"}
    )


LATEX_REWRITE_BLOCK_CLASSES = latex_rewrite_block_classes()
LATEX_NUMBERED_REWRITE_BLOCK_CLASSES = tuple(
    entry.name
    for entry in load_block_manifest_entries()
    if entry.numbered and entry.name in LATEX_REWRITE_BLOCK_CLASSES
)


def class_pattern(classes: tuple[str, ...]) -> str:
    return "|".join(re.escape(name) for name in classes)


@dataclass
class Author:
    name: str
    affiliation: str


@dataclass
class RenderedAsset:
    label: str
    kind: str
    block: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_tex", type=Path, help="Path to the LaTeX source file")
    parser.add_argument("output_md", type=Path, help="Path to write the markdown output")
    parser.add_argument(
        "--numbering",
        default="grouped",
        choices=("grouped", "global"),
        help="Frontmatter numbering mode",
    )
    parser.add_argument(
        "--copy-bibliography",
        action="store_true",
        help="Copy the detected .bib file next to the output markdown",
    )
    parser.add_argument(
        "--copy-assets",
        action="store_true",
        help="Copy detected figure assets next to the output markdown",
    )
    return parser.parse_args()


def require_pandoc() -> None:
    if shutil.which("pandoc"):
        return
    print("pandoc not found on PATH", file=sys.stderr)
    raise SystemExit(1)


def read_brace_group(text: str, start: int) -> tuple[str, int]:
    if start >= len(text) or text[start] != "{":
        raise ValueError("expected '{'")
    depth = 0
    i = start
    buf: list[str] = []
    while i < len(text):
        ch = text[i]
        if ch == "{":
            depth += 1
            if depth > 1:
                buf.append(ch)
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return "".join(buf), i + 1
            buf.append(ch)
        else:
            buf.append(ch)
        i += 1
    raise ValueError("unbalanced braces")


def skip_ws(text: str, index: int) -> int:
    while index < len(text) and text[index].isspace():
        index += 1
    return index


def read_control_word(text: str, index: int) -> tuple[str, int]:
    start = index
    while index < len(text) and text[index].isalpha():
        index += 1
    return text[start:index], index


def read_bracket_group(text: str, index: int) -> tuple[str, int]:
    if index >= len(text) or text[index] != "[":
        raise ValueError("expected bracket group")
    depth = 0
    buf: list[str] = []
    i = index
    while i < len(text):
        ch = text[i]
        if ch == "[":
            depth += 1
            if depth > 1:
                buf.append(ch)
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return "".join(buf), i + 1
            buf.append(ch)
        else:
            buf.append(ch)
        i += 1
    raise ValueError("unbalanced brackets")


def read_macro_definition_name(text: str, index: int) -> tuple[str | None, int]:
    index = skip_ws(text, index)
    if index < len(text) and text[index] == "{":
        group, cursor = read_brace_group(text, index)
        name = group.strip()
        return (name if name.startswith("\\") else None), cursor
    if index < len(text) and text[index] == "\\":
        name, cursor = read_control_word(text, index + 1)
        if name:
            return f"\\{name}", cursor
    return None, index


def extract_command_groups(text: str, command: str, group_count: int) -> list[list[str]]:
    results: list[list[str]] = []
    token = f"\\{command}"
    index = 0
    while True:
        start = text.find(token, index)
        if start == -1:
            return results
        cursor = start + len(token)
        groups: list[str] = []
        try:
            for _ in range(group_count):
                cursor = skip_ws(text, cursor)
                group, cursor = read_brace_group(text, cursor)
                groups.append(group)
        except ValueError:
            index = start + len(token)
            continue
        results.append(groups)
        index = cursor


def extract_first_group(text: str, command: str) -> str | None:
    groups = extract_command_groups(text, command, 1)
    if not groups:
        return None
    return groups[0][0].strip()


def extract_environment(text: str, env: str) -> str | None:
    match = re.search(rf"\\begin\{{{re.escape(env)}\}}(.*?)\\end\{{{re.escape(env)}\}}", text, re.S)
    if not match:
        return None
    return match.group(1).strip()


def collapse_ws(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def strip_math_delimiters(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("$") and stripped.endswith("$") and len(stripped) >= 2:
        return stripped[1:-1].strip()
    return stripped


def latex_inline_to_text(text: str) -> str:
    result = strip_math_delimiters(text)
    patterns = [
        (r"\\textsc\{([^{}]*)\}", r"\1"),
        (r"\\textul\{([^{}]*)\}", r"\1"),
        (r"\\operatorname\{([^{}]*)\}", r"\1"),
        (r"\\mathcal\{([^{}]*)\}", r"\1"),
        (r"\\mathbb\{([^{}]*)\}", r"\1"),
        (r"\\Comment\{([^{}]*)\}", r"# \1"),
    ]
    for pattern, repl in patterns:
        previous = None
        while previous != result:
            previous = result
            result = re.sub(pattern, repl, result)
    for src, dst in INLINE_REPLACEMENTS:
        result = result.replace(src, dst)
    result = result.replace("$", "")
    result = result.replace("{", "").replace("}", "")
    return collapse_ws(result)


def parse_macros(tex: str) -> dict[str, str]:
    preamble = tex.split("\\begin{document}", 1)[0]
    macros: dict[str, str] = {}
    aliases: list[tuple[str, str]] = []
    i = 0

    while i < len(preamble):
        macro_command = None
        if preamble.startswith("\\newcommand", i):
            macro_command = "\\newcommand"
        elif preamble.startswith("\\renewcommand", i):
            macro_command = "\\renewcommand"
        if macro_command:
            cursor = i + len(macro_command)
            try:
                name, cursor = read_macro_definition_name(preamble, cursor)
                if not name:
                    i += 1
                    continue
                cursor = skip_ws(preamble, cursor)
                if cursor < len(preamble) and preamble[cursor] == "[":
                    _arity, cursor = read_bracket_group(preamble, cursor)
                    cursor = skip_ws(preamble, cursor)
                    if cursor < len(preamble) and preamble[cursor] == "[":
                        _default, cursor = read_bracket_group(preamble, cursor)
                        cursor = skip_ws(preamble, cursor)
                body, cursor = read_brace_group(preamble, cursor)
            except ValueError:
                i += 1
                continue
            macros[name] = body
            i = cursor
            continue
        if preamble.startswith("\\def\\", i):
            cursor = i + len("\\def\\")
            name, cursor = read_control_word(preamble, cursor)
            if not name:
                i += 1
                continue
            while True:
                cursor = skip_ws(preamble, cursor)
                if cursor + 1 < len(preamble) and preamble[cursor] == "#" and preamble[cursor + 1].isdigit():
                    cursor += 2
                    continue
                break
            cursor = skip_ws(preamble, cursor)
            if cursor < len(preamble) and preamble[cursor] == "{":
                body, cursor = read_brace_group(preamble, cursor)
                macros[f"\\{name}"] = body
                i = cursor
                continue
        if preamble.startswith("\\let\\", i):
            cursor = i + len("\\let\\")
            alias, cursor = read_control_word(preamble, cursor)
            cursor = skip_ws(preamble, cursor)
            if cursor < len(preamble) and preamble[cursor] == "\\":
                target, cursor = read_control_word(preamble, cursor + 1)
                if alias and target:
                    aliases.append((f"\\{alias}", f"\\{target}"))
                    i = cursor
                    continue
        if preamble.startswith("\\DeclareMathOperator", i):
            cursor = i + len("\\DeclareMathOperator")
            if cursor < len(preamble) and preamble[cursor] == "*":
                cursor += 1
            cursor = skip_ws(preamble, cursor)
            try:
                name, cursor = read_brace_group(preamble, cursor)
                cursor = skip_ws(preamble, cursor)
                body, cursor = read_brace_group(preamble, cursor)
            except ValueError:
                i += 1
                continue
            macros[name] = f"\\operatorname{{{body}}}"
            i = cursor
            continue
        i += 1

    unresolved = aliases[:]
    while unresolved:
        next_round: list[tuple[str, str]] = []
        progress = False
        for alias, target in unresolved:
            if target in macros:
                macros[alias] = macros[target]
                progress = True
            else:
                next_round.append((alias, target))
        if not progress:
            for alias, target in next_round:
                macros[alias] = target
            break
        unresolved = next_round

    return macros


def resolve_asset(asset: str, input_dir: Path) -> Path | None:
    candidate = input_dir / asset
    if candidate.exists() and candidate.is_file():
        return candidate
    if candidate.suffix:
        return None
    for ext in GRAPHICS_EXTENSIONS:
        with_ext = input_dir / f"{asset}{ext}"
        if with_ext.exists():
            return with_ext
    return None


def materialize_reference(source: Path | None, output_dir: Path, copy_file: bool) -> str | None:
    if source is None:
        return None
    if copy_file:
        target = output_dir / source.name
        if source.resolve() != target.resolve():
            shutil.copy2(source, target)
        return target.name
    return str(Path(os.path.relpath(source, output_dir)))


def algorithm_title(algo_body: str, fallback: str) -> str:
    header = extract_first_group(algo_body, "textul")
    if not header:
        return fallback
    title = latex_inline_to_text(header)
    title = title.rstrip(":")
    if "(" in title:
        title = title.split("(", 1)[0]
    return title or fallback


def algorithm_signature(algo_body: str) -> str | None:
    header = extract_first_group(algo_body, "textul")
    if not header:
        return None
    text = latex_inline_to_text(header).rstrip(":")
    if "(" not in text or ")" not in text:
        return None
    return text[text.index("(") + 1 : text.rindex(")")].strip() or None


def latex_sentence(text: str) -> str:
    cleaned = latex_inline_to_text(text).strip()
    if not cleaned:
        return cleaned
    return cleaned[0].upper() + cleaned[1:]


def render_algorithm_block(label: str, algo_body: str, fallback_title: str) -> str:
    title = algorithm_title(algo_body, fallback_title)
    signature = algorithm_signature(algo_body)
    normalized = algo_body.replace("\n", " ")
    segments = normalized.split("\\\\")
    lines: list[str] = []
    if signature:
        lines.append(f"Input: {signature}")
    for segment in segments[1:]:
        raw = segment.rstrip()
        if not raw.strip():
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        level = 2 if indent >= 4 else 0
        cleaned = raw.strip()
        cleaned = cleaned.replace("\\+", "").replace("\\-", "")
        cleaned = latex_inline_to_text(cleaned)
        cleaned = cleaned.rstrip(":")
        if not cleaned:
            continue
        lines.append(f"{' ' * level}{cleaned}")
    code = "\n".join(lines)
    return f":::: {{#{label} .algorithm}} {title}\n```text\n{code}\n```\n::::"


def render_figure_block(label: str, caption: str, src_ref: str) -> str:
    return f"::: {{#{label} .figure}} {caption}\n![{caption}]({src_ref})\n:::"


def extract_rendered_assets(tex: str, input_dir: Path, output_dir: Path, copy_assets: bool) -> dict[str, RenderedAsset]:
    assets: dict[str, RenderedAsset] = {}
    figure_pattern = re.compile(r"\\begin\{(figure\*?|figure)\}(.*?)\\end\{\1\}", re.S)
    for match in figure_pattern.finditer(tex):
        block = match.group(2)
        label = extract_first_group(block, "label")
        caption = collapse_ws(extract_first_group(block, "caption") or "")
        if not label:
            continue
        algo_match = re.search(r"\\begin\{algo\}(.*?)\\end\{algo\}", block, re.S)
        if algo_match:
            title = caption or label.split(":", 1)[-1]
            assets[label] = RenderedAsset(label=label, kind="algorithm", block=render_algorithm_block(label, algo_match.group(1), title))
            continue
        graphics_match = re.search(r"\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}", block)
        if not graphics_match:
            continue
        source = resolve_asset(graphics_match.group(1), input_dir)
        if source is None:
            continue
        src_ref = materialize_reference(source, output_dir, copy_assets)
        if src_ref is None:
            continue
        assets[label] = RenderedAsset(label=label, kind="figure", block=render_figure_block(label, caption or label, src_ref))
    return assets


def rewrite_problem_blocks(text: str) -> str:
    pattern = re.compile(
        r"::: problem\n\*\*Problem \d+\*\* \((.*?)\)\. \*(.*?)\*\n:::",
        re.S,
    )

    def repl(match: re.Match[str]) -> str:
        title = collapse_ws(match.group(1))
        body = collapse_ws(match.group(2))
        lower = body.lower()
        if lower.startswith("given ") and ", find " in lower:
            split_at = lower.index(", find ")
            prefix = body[:split_at]
            suffix = body[split_at + len(", find ") :]
            input_text = prefix[len("Given ") :] if prefix.startswith("Given ") else prefix
            input_text = latex_sentence(input_text).rstrip(".")
            suffix = latex_sentence(suffix).rstrip(".")
            return (
                f"::: {{.problem}} {title}\n"
                f"**Input:** {input_text}.\n\n"
                f"**Output:** {suffix}.\n"
                f":::"
            )
        return f"::: {{.problem}} {title}\n{body}\n:::"

    return pattern.sub(repl, text)


def rewrite_theorem_blocks(text: str) -> str:
    numbered_classes = class_pattern(LATEX_NUMBERED_REWRITE_BLOCK_CLASSES)
    rewrite_classes = class_pattern(LATEX_REWRITE_BLOCK_CLASSES)
    text = re.sub(
        rf'^::: ({numbered_classes})\n\[\]\{{#([^ ]+) label="[^"]+"\}}\s*',
        lambda m: f'::: {{#{m.group(2)} .{m.group(1)}}}\n',
        text,
        flags=re.M,
    )
    text = re.sub(
        rf"^::: ({rewrite_classes})\s*$",
        lambda m: f"::: {{.{m.group(1)}}}",
        text,
        flags=re.M,
    )
    text = re.sub(r"^::: proof\n\*Proof\.\*\s*", "::: {.proof}\n", text, flags=re.M)
    text = re.sub(r"\s*◻\n:::", "\n:::", text)
    return text


def rewrite_references(text: str, assets: dict[str, RenderedAsset]) -> str:
    text = re.sub(r"\[\\\[([^\]]+)\\\]\]\(#([^)]+)\)\{[^}]+\}", r"[@\2]", text)

    text = re.sub(
        r"\[(\d+(?:\.\d+)?)\]\(#(sec:[^)]+)\)\{[^}]+\}",
        lambda m: f"[@{m.group(2)}]",
        text,
    )
    text = re.sub(
        r"\[(\d+)\]\(#([^)]*)\)\{[^}]+\}",
        lambda m: f"[@{m.group(2)}]",
        text,
    )
    return text


def replace_html_figures(text: str, assets: dict[str, RenderedAsset]) -> str:
    pattern = re.compile(r'<figure id="([^"]+)"[^>]*>.*?</figure>', re.S)

    def repl(match: re.Match[str]) -> str:
        label = match.group(1)
        asset = assets.get(label)
        if asset is None:
            return match.group(0)
        return asset.block

    return pattern.sub(repl, text)


def clean_pandoc_markdown(text: str, assets: dict[str, RenderedAsset]) -> str:
    text = rewrite_problem_blocks(text)
    text = rewrite_theorem_blocks(text)
    text = rewrite_references(text, assets)
    text = replace_html_figures(text, assets)
    text = text.replace("#### Our Contributions {#our-contributions .unnumbered}", "## Our Contributions")
    text = text.replace("# Proximity result {#sec:proximityresult}", "# Proximity Result {#sec:proximityresult}")
    text = text.replace("# The new algorithm {#sec:algo}", "# The New Algorithm {#sec:algo}")
    text = text.replace("\\mathop{\\mathrm{MST}}", "\\operatorname{MST}")
    text = text.replace("$$\\begin{equation*}\n", "$$\n")
    text = text.replace("\\end{equation*}$$", "$$")
    return text.strip()


def used_macros_in(text: str, known_macros: dict[str, str]) -> dict[str, str]:
    used_names = set(re.findall(r"(?<!\\)(\\[A-Za-z]+)", text))
    return {name: known_macros[name] for name in known_macros if name in used_names}


def yaml_quote(text: str) -> str:
    return "'" + text.replace("'", "''") + "'"


def render_frontmatter(
    *,
    title: str | None,
    bibliography_ref: str | None,
    numbering: str,
    macros: dict[str, str],
    need_figure_block: bool,
) -> str:
    lines = ["---"]
    if title:
        lines.append(f"title: {title}")
    if bibliography_ref:
        lines.append(f"bibliography: {bibliography_ref}")
    lines.append(f"numbering: {numbering}")
    if macros:
        lines.append("math:")
        for name, expansion in macros.items():
            lines.append(f"  {yaml_quote(name)}: {yaml_quote(expansion)}")
    if need_figure_block:
        lines.extend(
            [
                "blocks:",
                "  figure:",
                "    title: Figure",
                "    counter: figure",
            ]
        )
    lines.append("---")
    return "\n".join(lines)


def render_metadata_block(
    *,
    authors: list[Author],
    abstract: str | None,
    keywords: str | None,
    funding: str | None,
) -> str:
    lines: list[str] = []
    if authors:
        names = [author.name for author in authors]
        heading = names[0] if len(names) == 1 else ", ".join(names[:-1]) + f", and {names[-1]}"
        lines.append(f"*{heading}*")
        lines.append("")
        for author in authors:
            lines.append(f"{author.name}: {collapse_ws(author.affiliation)}")
            lines.append("")
    if abstract:
        lines.append("## Abstract {-}")
        lines.append("")
        lines.append(collapse_ws(abstract))
        lines.append("")
    if keywords:
        lines.append(f"**Keywords:** {collapse_ws(keywords)}.")
        lines.append("")
    if funding:
        lines.append(f"**Funding:** {collapse_ws(funding)}")
        lines.append("")
    return "\n".join(lines).strip()


def run_pandoc(input_tex: Path) -> str:
    with tempfile.TemporaryDirectory(prefix="coflat-latex-") as tmpdir:
        tmp_output = Path(tmpdir) / "pandoc.md"
        subprocess.run(
            [
                "pandoc",
                str(input_tex),
                "-f",
                "latex",
                "-t",
                "markdown+raw_tex",
                "--wrap=none",
                "-o",
                str(tmp_output),
            ],
            check=True,
        )
        return tmp_output.read_text()


def build_document(args: argparse.Namespace) -> str:
    tex = args.input_tex.read_text()
    output_dir = args.output_md.parent
    title = extract_first_group(tex, "title")
    abstract = extract_environment(tex, "abstract")
    keywords = extract_first_group(tex, "keywords")
    funding = extract_first_group(tex, "funding")
    acknowledgements = extract_first_group(tex, "acknowledgements")

    authors = [Author(name=collapse_ws(groups[0]), affiliation=collapse_ws(groups[1])) for groups in extract_command_groups(tex, "author", 5)]
    bibliography_source = None
    bibliography_name = extract_first_group(tex, "bibliography")
    if bibliography_name:
        bibliography_source = (args.input_tex.parent / f"{bibliography_name}.bib").resolve()
    bibliography_ref = materialize_reference(bibliography_source, output_dir, args.copy_bibliography)

    assets = extract_rendered_assets(tex, args.input_tex.parent, output_dir, args.copy_assets)
    scaffold = run_pandoc(args.input_tex)
    body = clean_pandoc_markdown(scaffold, assets)
    macros = used_macros_in(body, parse_macros(tex))
    frontmatter = render_frontmatter(
        title=collapse_ws(title) if title else None,
        bibliography_ref=bibliography_ref,
        numbering=args.numbering,
        macros=macros,
        need_figure_block=any(asset.kind == "figure" for asset in assets.values()),
    )
    metadata = render_metadata_block(authors=authors, abstract=abstract, keywords=keywords, funding=funding)
    pieces = [frontmatter]
    if metadata:
        pieces.extend(["", metadata])
    pieces.extend(["", body])
    if acknowledgements:
        pieces.extend(["", "## Acknowledgements {-}", "", collapse_ws(acknowledgements)])
    return "\n".join(piece for piece in pieces if piece is not None).strip() + "\n"


def main() -> None:
    args = parse_args()
    require_pandoc()
    args.output_md.parent.mkdir(parents=True, exist_ok=True)
    document = build_document(args)
    args.output_md.write_text(document)


if __name__ == "__main__":
    main()
