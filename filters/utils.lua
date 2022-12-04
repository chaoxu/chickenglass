function pandocInlineRead(data)
    local blocks = pandoc.read(data,"markdown",PANDOC_READER_OPTIONS)
    local inlines = pandoc.utils.blocks_to_inlines(blocks.blocks)
    return inlines
end

-- slow checking if a table contains a particular element
-- but fast enough for very small tables(most likely the case here)
function table.contains(table, element)
  for _, value in pairs(table) do
    if value == element then
      return true
    end
  end
  return false
end