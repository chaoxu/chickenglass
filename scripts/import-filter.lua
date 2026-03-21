-- Pandoc Lua filter for importing blog posts into Chickenglass.
--
-- Transforms:
--   1. BlockQuote → Div with class "Blockquote" (fenced div)
--   2. Bare LaTeX math environments → DisplayMath
--   3. Removes trailing "Reference" or "References" headings
--   4. Force fenced code blocks (no indented code)
--
-- Usage:
--   pandoc -f markdown -t markdown --lua-filter=scripts/import-filter.lua input.md -o output.md

-- LaTeX environments that should always be display math, not inline.
local display_envs = {
  "align", "align*", "aligned", "equation", "equation*",
  "gather", "gather*", "multline", "multline*", "flalign", "flalign*",
  "cases", "pmatrix", "bmatrix", "vmatrix", "array",
}

-- Check if text starts with a display math environment.
local function is_display_env(text)
  for _, env in ipairs(display_envs) do
    if text:match("^\\begin{" .. env:gsub("%*", "%%%%*") .. "}") then
      return true
    end
  end
  return false
end

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
function RawBlock(el)
  if (el.format == "tex" or el.format == "latex") and is_display_env(el.text) then
    return pandoc.Para({pandoc.Math("DisplayMath", el.text)})
  end
  return el
end

-- Handle inline raw TeX: promote display-math environments to DisplayMath,
-- and convert other LaTeX commands to InlineMath.
function RawInline(el)
  if el.format == "tex" or el.format == "latex" then
    if is_display_env(el.text) then
      return pandoc.Math("DisplayMath", el.text)
    end
    if el.text:match("^\\[a-zA-Z]") then
      return pandoc.Math("InlineMath", el.text)
    end
  end
  return el
end

-- Promote InlineMath containing display-math environments to DisplayMath.
function Math(el)
  if el.mathtype == "InlineMath" and is_display_env(el.text) then
    return pandoc.Math("DisplayMath", el.text)
  end
  return el
end

-- Split paragraphs that contain DisplayMath inlines into separate blocks.
-- When \begin{align*} appears mid-paragraph (after text without blank line),
-- Pandoc keeps it inline. We split: text before → Para, math → Para(DisplayMath),
-- text after → Para.
function Para(el)
  local has_display = false
  for _, inline in ipairs(el.content) do
    if inline.t == "Math" and inline.mathtype == "DisplayMath" then
      has_display = true
      break
    end
  end
  if not has_display then return el end

  local blocks = {}
  local current = {}
  for _, inline in ipairs(el.content) do
    if inline.t == "Math" and inline.mathtype == "DisplayMath" then
      -- Flush preceding inlines as a Para (if non-empty)
      if #current > 0 then
        -- Trim trailing spaces/softbreaks
        while #current > 0 and (current[#current].t == "Space" or current[#current].t == "SoftBreak") do
          table.remove(current)
        end
        if #current > 0 then
          table.insert(blocks, pandoc.Para(current))
        end
        current = {}
      end
      -- Add display math as its own block
      table.insert(blocks, pandoc.Para({inline}))
    else
      table.insert(current, inline)
    end
  end
  -- Flush remaining inlines
  if #current > 0 then
    -- Trim leading spaces/softbreaks
    while #current > 0 and (current[1].t == "Space" or current[1].t == "SoftBreak") do
      table.remove(current, 1)
    end
    if #current > 0 then
      table.insert(blocks, pandoc.Para(current))
    end
  end

  if #blocks == 1 then return blocks[1] end
  return blocks
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
