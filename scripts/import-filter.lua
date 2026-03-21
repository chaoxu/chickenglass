-- Pandoc Lua filter for importing blog posts into Chickenglass.
--
-- Transforms:
--   1. BlockQuote → Div with class "Blockquote" (fenced div)
--   2. CodeBlock without fences → adds fences (Pandoc handles this via markdown output)
--   3. Removes trailing "Reference" or "References" headings
--
-- Usage:
--   pandoc -f markdown -t markdown --lua-filter=scripts/import-filter.lua input.md -o output.md

-- Convert blockquotes to fenced divs with class "Blockquote"
function BlockQuote(el)
  return pandoc.Div(el.content, pandoc.Attr("", {"Blockquote"}))
end

-- Remove "Reference" or "References" headings (empty Hakyll markers)
function Header(el)
  local text = pandoc.utils.stringify(el)
  if text:match("^[Rr]eference[s]?$") then
    return {} -- remove the heading
  end
  return el
end

-- Convert bare LaTeX math environments (RawBlock "tex") to DisplayMath.
-- Pandoc treats \begin{align*}...\end{align*} without \[...\] as raw TeX.
-- We wrap them as proper display math so they render via KaTeX.
function RawBlock(el)
  if el.format == "tex" or el.format == "latex" then
    local text = el.text
    -- Check if it's a math environment
    if text:match("^\\begin{align") or
       text:match("^\\begin{equation") or
       text:match("^\\begin{gather") or
       text:match("^\\begin{multline") or
       text:match("^\\begin{flalign") or
       text:match("^\\begin{cases") or
       text:match("^\\begin{pmatrix") or
       text:match("^\\begin{bmatrix") or
       text:match("^\\begin{vmatrix") or
       text:match("^\\begin{array") then
      return pandoc.Para({pandoc.Math("DisplayMath", text)})
    end
  end
  return el
end

-- Also handle inline raw TeX that should be math
function RawInline(el)
  if el.format == "tex" or el.format == "latex" then
    local text = el.text
    -- LaTeX commands that should be inline math
    if text:match("^\\[a-zA-Z]") then
      return pandoc.Math("InlineMath", text)
    end
  end
  return el
end

-- Force fenced code blocks: Pandoc's markdown writer uses indented code
-- by default when there are no attributes. Convert to raw markdown
-- with explicit ``` fencing.
function CodeBlock(el)
  if #el.classes == 0 then
    local fence = "```\n" .. el.text .. "\n```"
    return pandoc.RawBlock("markdown", fence)
  end
  return el
end
