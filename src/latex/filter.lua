-- Pandoc filter: Coflat-flavored markdown -> LaTeX.
--
-- Responsibilities:
--   * YAML "math:" frontmatter -> \newcommand in header-includes.
--   * [@thm:foo], [@sec:foo], etc. -> \cref; bare-id refs to known labels
--     likewise; anything else -> \cite.
--   * Manifest-backed fenced-div blocks
--     divs -> matching LaTeX environments.
--   * Multi-image figure divs -> subfigure wrappers.
--   * <br> in table cells -> \newline.
--
-- A `title="..."` attribute on the div (added by the Coflat lift-titles step)
-- is used as the theorem title / figure caption / table caption / algorithm
-- caption.

local function script_dir()
  local source = debug.getinfo(1, "S").source
  local path = source and source:match("^@(.+)$") or nil
  if not path then return "./" end
  return path:match("^(.*[/\\])") or "./"
end

local syntax = dofile(script_dir() .. "syntax-manifest.lua")
local xref_prefixes = syntax.xref_prefixes

local known_labels = {}

local function is_xref_id(id)
  local prefix = id:match("^([%w%-]+):")
  if prefix and xref_prefixes[prefix] then return true end
  return known_labels[id] == true
end

local function first_latex_class(classes)
  for _, c in ipairs(classes) do
    local kind = syntax.latex_kind_by_block[c]
    if kind and kind ~= "none" then return c, kind end
  end
  return nil, nil
end

local function label_for(id)
  if id and id ~= "" then return "\\label{" .. id .. "}" else return "" end
end

local function raw(s) return pandoc.RawBlock("latex", s) end

local latex_text_escapes = {
  ["\\"] = "\\textbackslash{}",
  ["{"] = "\\{",
  ["}"] = "\\}",
  ["$"] = "\\$",
  ["&"] = "\\&",
  ["#"] = "\\#",
  ["_"] = "\\_",
  ["%"] = "\\%",
  ["~"] = "\\textasciitilde{}",
  ["^"] = "\\textasciicircum{}",
}

local function escape_latex_text(s)
  if not s or s == "" then return "" end
  return (s:gsub(".", function(ch) return latex_text_escapes[ch] or ch end))
end

local function pop_title(el)
  return el.attributes and el.attributes.title or nil
end

local function make_env(name, title, id, content)
  local opt = (title and title ~= "") and ("[" .. escape_latex_text(title) .. "]") or ""
  local out = { raw("\\begin{" .. name .. "}" .. opt .. label_for(id)) }
  for _, b in ipairs(content) do table.insert(out, b) end
  table.insert(out, raw("\\end{" .. name .. "}"))
  return out
end

local function inlines_to_latex(inlines)
  if not inlines or #inlines == 0 then return "" end
  return pandoc.write(pandoc.Pandoc({ pandoc.Plain(inlines) }), "latex")
end

local function handle_figure(el)
  local title = escape_latex_text(pop_title(el) or "")
  local id = el.identifier
  local images = {}

  local function collect(block)
    if block.t == "Figure" then
      local img
      pandoc.walk_block(block, { Image = function(i) img = img or i end })
      if img then
        local caption_inlines = block.caption.long and block.caption.long[1]
                                  and block.caption.long[1].content
        local cap = inlines_to_latex(caption_inlines)
        if (not cap) or cap == "" then cap = inlines_to_latex(img.caption) end
        table.insert(images, { src = img.src, caption = cap })
      end
      return
    end
    if block.content then
      pandoc.walk_block(block, {
        Image = function(img)
          table.insert(images, { src = img.src, caption = inlines_to_latex(img.caption) })
        end,
      })
    end
  end

  for _, b in ipairs(el.content) do collect(b) end

  if #images == 0 then return nil end

  local out = { raw("\\begin{figure}[ht]\\centering") }

  if #images == 1 then
    local img = images[1]
    table.insert(out, raw("\\includegraphics[width=0.8\\linewidth]{" .. img.src .. "}"))
  else
    local width = string.format("%.3f", 1.0 / math.min(#images, 3) - 0.01)
    for _, img in ipairs(images) do
      table.insert(out, raw("\\begin{subfigure}[t]{" .. width .. "\\textwidth}\\centering"))
      table.insert(out, raw("\\includegraphics[width=\\linewidth]{" .. img.src .. "}"))
      table.insert(out, raw("\\caption{" .. img.caption .. "}"))
      table.insert(out, raw("\\end{subfigure}\\hfill"))
    end
  end

  table.insert(out, raw("\\caption{" .. title .. "}" .. label_for(id)))
  table.insert(out, raw("\\end{figure}"))
  return out
end

local function cell_to_latex(cell)
  local parts = {}
  for _, blk in ipairs(cell.contents) do
    if blk.t == "Plain" or blk.t == "Para" then
      local inlines = {}
      for _, inl in ipairs(blk.content) do
        local is_br = inl.t == "LineBreak"
        if inl.t == "RawInline" and inl.format == "html" then
          local t = inl.text:lower():gsub("%s", "")
          if t == "<br>" or t == "<br/>" or t == "<br />" then
            is_br = true
          end
        end
        if is_br then
          table.insert(inlines, pandoc.RawInline("latex", "\\newline "))
        else
          table.insert(inlines, inl)
        end
      end
      local s = inlines_to_latex(inlines)
      s = s:gsub("%s+$", "")
      table.insert(parts, s)
    end
  end
  return table.concat(parts, " \\newline ")
end

local function rows_to_latex(rows)
  local lines = {}
  for _, row in ipairs(rows) do
    local cells = {}
    for _, cell in ipairs(row.cells) do
      table.insert(cells, cell_to_latex(cell))
    end
    table.insert(lines, table.concat(cells, " & ") .. " \\\\")
  end
  return table.concat(lines, "\n")
end

local function colspec_of(colspecs)
  local parts = { "@{}" }
  for _, cs in ipairs(colspecs) do
    local w = cs[2]
    if type(w) == "number" and w > 0.15 then
      table.insert(parts, "X")
    else
      table.insert(parts, "l")
    end
  end
  table.insert(parts, "@{}")
  return table.concat(parts)
end

local function handle_table_div(el)
  local title = escape_latex_text(pop_title(el) or "")
  local id = el.identifier
  for _, b in ipairs(el.content) do
    if b.t == "Table" then
      local colspec = colspec_of(b.colspecs)
      local head_rows = rows_to_latex(b.head.rows)
      local body_lines = {}
      for _, body in ipairs(b.bodies) do
        table.insert(body_lines, rows_to_latex(body.body))
      end
      local body_rows = table.concat(body_lines, "\n")
      local latex = table.concat({
        "\\begin{table}[!htbp]",
        "\\centering",
        "\\caption{" .. title .. "}" .. label_for(id),
        "\\small",
        "\\begin{tabularx}{\\textwidth}{" .. colspec .. "}",
        "\\toprule",
        head_rows,
        "\\midrule",
        body_rows,
        "\\bottomrule",
        "\\end{tabularx}",
        "\\end{table}",
      }, "\n")
      return { raw(latex) }
    end
  end
  return nil
end

local function handle_algorithm(el)
  local title = escape_latex_text(pop_title(el) or "")
  local id = el.identifier
  local out = { raw("\\begin{algorithm}[ht]\\caption{" .. title .. "}" .. label_for(id)) }
  for _, b in ipairs(el.content) do table.insert(out, b) end
  table.insert(out, raw("\\end{algorithm}"))
  return out
end

local function handle_blockquote(el)
  local out = { raw("\\begin{quote}") }
  for _, b in ipairs(el.content) do table.insert(out, b) end
  table.insert(out, raw("\\end{quote}"))
  return out
end

local function transform_div(el)
  local cls, kind = first_latex_class(el.classes)
  if kind == "environment" then
    return make_env(syntax.latex_environment_by_block[cls], pop_title(el), el.identifier, el.content)
  end
  if kind == "figure" then return handle_figure(el) end
  if kind == "table" then return handle_table_div(el) end
  if kind == "algorithm" then return handle_algorithm(el) end
  if kind == "blockquote" then return handle_blockquote(el) end
  return nil
end

local function transform_cite(el)
  local segments = {}

  local function append_segment(kind, id)
    local last = segments[#segments]
    if last and last.kind == kind then
      table.insert(last.ids, id)
    else
      table.insert(segments, { kind = kind, ids = { id } })
    end
  end

  for _, c in ipairs(el.citations) do
    if is_xref_id(c.id) then append_segment("xref", c.id)
    else                     append_segment("bib", c.id) end
  end

  local pieces = {}
  for _, segment in ipairs(segments) do
    local macro = segment.kind == "xref" and "\\cref" or "\\cite"
    table.insert(pieces, macro .. "{" .. table.concat(segment.ids, ",") .. "}")
  end

  return pandoc.RawInline("latex", table.concat(pieces, "; "))
end

-- The Pandoc reader profile enables the `mark` extension, so ==text== reaches
-- the LaTeX writer as a mark span and becomes \hl{...}; no custom filter
-- handling is needed here.

function Pandoc(doc)
  -- Pass 1: collect every defined label.
  doc:walk({
    Div    = function(el) if el.identifier ~= "" then known_labels[el.identifier] = true end end,
    Header = function(el) if el.identifier ~= "" then known_labels[el.identifier] = true end end,
  })
  -- Pass 2: transform.
  return doc:walk({ Cite = transform_cite, Div = transform_div })
end
