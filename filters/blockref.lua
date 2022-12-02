local logging = require 'logging'
blockref = {}

-- Most basic cite
-- Note this might cause unexpected behaviors when cite together with other elements
-- Todo: check what they are doing 
-- https://github.com/quarto-dev/quarto-cli/blob/main/src/resources/filters/crossref/refs.lua


function Cite(citeEl)
  -- scan citations for refs
  local refs = pandoc.List()
  --logging.temp(citeEl)
  for i, cite in ipairs (citeEl.citations) do
    local label = cite.id

    -- get corresponding ref
    local refData = blockref[label]
    if refData then 
      local refName = refData.refName
      local attr = {}
      attr["data-ref-class"] = refData.refClass
      if refName then
        local ref = {
          pandoc.Span(
            pandoc.Link(refName, "#" .. label)
            ,pandoc.Attr("",{"ref"},attr
          )
          )}
        refs:extend(ref)
      end
    end
  end
  if #refs > 0 then
    return refs
  else
    return citeEl
  end
end

function Div(div)
  local refClass = div.attr.attributes["data-ref-class"]
  local refIndex = div.attr.attributes["data-ref-index"]
  local id      = div.attr.identifier
  if refClass then 
    if id ~= "" then
      refName = refClass.." "..refIndex
      blockref[id]={refIndex = refIndex, refClass = refClass, refName = refName}
    end
  end
end

-- First process div then process cite

return {
  { Div = Div },  -- (1)
  { Cite = Cite }    -- (2)
}
