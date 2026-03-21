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
