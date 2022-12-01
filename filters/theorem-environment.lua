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



-- we find certain theorem and add theorem-environment css
-- we parse the title as a markdown
-- or we parse the first heading as markdown

theoremClasses = {
    Theorem = {
        env = "theorem",
        style = "theorem",
        title = "Theorem"
    },
    Lemma = {
        env = "lemma",
        style = "theorem",
        title = "Lemma"
    },
    Corollary = {
        env = "corollary",
        style = "theorem",
        title = "Corollary"
    },
    Proposition = {
        env = "proposition",
        style = "theorem",
        title = "Proposition"
    },
    Conjecture = {
        env = "conjecture",
        style = "theorem",
        title = "Conjecture"
    },
    Proof = {
        env = "proof"
        style = "proof"
        title = ""
    }
    Remark = {
        env = "remark"
        style = "remark"
        title = "Remark"
    }
}

function hasTheoremType(el)
  local classes = el.attr.classes

  return theoremClasses[classes] ~= nil
end

function Div(content, attr)
    if attr.classes in theorem_names then
        attr.classes.append("theorem-environment")
        return pandoc.Div(content, attr)
end
