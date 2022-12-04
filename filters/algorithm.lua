-- It suppose to be, in some sense, inline markdown that preserves white space

local logging = require 'logging'

local numbering = 0

require "utils"

function Pandoc(pandoc)
	logging.temp(pandoc)
end

-- match lines
function magiclines(s)
    if s:sub(-1)~="\n" then s=s.."\n" end
    return s:gmatch("(.-)\n")
end

function CodeBlock(content)
	logging.temp(content)
    logging.temp(content.attr.identifier)
	if table.contains(content.attr.classes, "algorithm") then
        numbering = numbering+1
        name = content.attr.attributes["title"]

        local index = tostring(numbering)
		local z = ""
        for line in magiclines(content.text) do
            z = z.."| "..line.."\n"
		end
        local p = pandoc.read(z, "markdown", PANDOC_READER_OPTIONS)

        local caption_inline = {pandoc.Span("Algorithm "..index..".")}

        
        if name then
            local name_span = pandoc.Span(pandocInlineRead(name),pandoc.Attr("",{"name"}))
            table.insert(caption_inline, name_span)
        end

        local caption_block = pandoc.Div(caption_inline,pandoc.Attr("",{"caption"}))
        table.insert(p.blocks,caption_block) 
        p = pandoc.Div(p.blocks,pandoc.Attr(content.attr.identifier,{"algorithm"}))
        p.attr.attributes["data-ref-class"] = "Algorithm"
        p.attr.attributes["data-ref-index"] = index
        --logging.temp(p)
        return p
	end
end