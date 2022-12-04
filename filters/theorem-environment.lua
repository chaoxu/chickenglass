--[[
theorem-environment – create theorem environment for theorem like classes
This code does not work yet!

Copyright: © 2022 Chao Xu
License:   MIT – see LICENSE file for details
]]

--[[
So for each type we need to define:
 - Yes or no numbering
 - Numbering category: same category has the same numbering
 - Optional extra operations
]]

require "utils"
-- we find certain theorem and add theorem-environment css
-- we parse the title as a markdown
-- or we parse the first heading as markdown
local logging = require 'logging'

theoremClasses = {
    Theorem = {
        env = "theorem",
        counter = "theorem",
        title = "Theorem"
    },
    Lemma = {
        env = "lemma",
        counter = "theorem",
        title = "Lemma"
    },
    Corollary = {
        env = "corollary",
        counter = "theorem",
        title = "Corollary"
    },
    Proposition = {
        env = "proposition",
        counter = "theorem",
        title = "Proposition"
    },
    Conjecture = {
        env = "conjecture",
        counter = "theorem",
        title = "Conjecture"
    },
    Proof = {
        env = "proof",
        title = "Proof"
    },
    Remark = {
        env = "remark",
        title = "Remark"
    }
}

local numbering = {}

numbering["theorem"] = 0

function hasTheoremType(classes)
  for _, class in ipairs(classes) do
    if theoremClasses[class] ~= nil then
        return theoremClasses[class]
    end
  end
end

function Div(div)
    content = div.content
    classes = div.attr.classes
    if classes then
        class = hasTheoremType(classes)
        if class then
            -- counter update
            theorem_header_inline = pandoc.List()
            -- type of the theorem
            type_span = pandoc.Span(pandoc.Str(class.title),pandoc.Attr("",{"type"}))
            table.insert(theorem_header_inline, type_span)

            -- index of the theorem
            local index
            if numbering[class.counter] then
                numbering[class.counter] = numbering[class.counter]+1
                index = tostring(numbering[class.counter])
            end
            if index then
                index_span = pandoc.Span(pandoc.Str(index),pandoc.Attr("",{"index"}))
                table.insert(theorem_header_inline, index_span)
            end

            -- name of the theorem
            -- note this is INLINE, so some work is required
            local name = div.attr.attributes["title"]
            if name then
                inlines = pandocInlineRead(name)
                name_span = pandoc.Span(inlines,pandoc.Attr("",{"name"}))
                table.insert(theorem_header_inline, name_span)
            end

            --logging.temp(theorem_header_inline)
            header = pandoc.Span(pandoc.Inlines(theorem_header_inline), pandoc.Attr("",{"theorem-header"}))

            table.insert(content, 1, header)
            table.insert(classes, "theorem-environment")
            -- compute the name
            div.attr.attributes["data-ref-class"] = class.title
            if index then
              div.attr.attributes["data-ref-index"] = index
            end
            --logging.temp(div)
            return pandoc.Div(div)
        end
    end
end
