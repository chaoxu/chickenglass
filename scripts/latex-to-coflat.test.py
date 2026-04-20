import importlib.util
import sys
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).with_name("latex-to-coflat.py")


def load_module():
    spec = importlib.util.spec_from_file_location("latex_to_coflat", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load latex-to-coflat.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class LatexToCoflatManifestTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_module()

    def test_latex_block_vocabulary_is_derived_from_block_manifest(self):
        self.assertIn("conjecture", self.module.LATEX_REWRITE_BLOCK_CLASSES)
        self.assertIn("problem", self.module.LATEX_REWRITE_BLOCK_CLASSES)
        self.assertIn("example", self.module.LATEX_REWRITE_BLOCK_CLASSES)
        self.assertIn("remark", self.module.LATEX_REWRITE_BLOCK_CLASSES)
        self.assertNotIn("youtube", self.module.LATEX_REWRITE_BLOCK_CLASSES)
        self.assertNotIn("include", self.module.LATEX_REWRITE_BLOCK_CLASSES)

    def test_rewrites_manifest_backed_block_classes(self):
        markdown = "\n\n".join(
            [
                "::: remark\nA note\n:::",
                "::: example\nAn example\n:::",
                "::: problem\nA problem\n:::",
            ]
        )

        rewritten = self.module.rewrite_theorem_blocks(markdown)

        self.assertIn("::: {.remark}", rewritten)
        self.assertIn("::: {.example}", rewritten)
        self.assertIn("::: {.problem}", rewritten)

    def test_rewrites_numbered_manifest_blocks_with_labels(self):
        markdown = '::: conjecture\n[]{#conj:main label="conj:main"}\nBody\n:::'

        rewritten = self.module.rewrite_theorem_blocks(markdown)

        self.assertIn("::: {#conj:main .conjecture}", rewritten)

    def test_parse_macros_supports_exported_and_legacy_forms(self):
        tex = r"""
        \newcommand{\R}{\mathbb{R}}
        \newcommand{\floor}[1]{\lfloor #1 \rfloor}
        \renewcommand{\epsilon}{\varepsilon}
        \def\old#1{\operatorname{old}(#1)}
        \let\alias\R
        \DeclareMathOperator{\supp}{supp}
        \begin{document}
        Body
        \end{document}
        """

        macros = self.module.parse_macros(tex)

        self.assertEqual(macros["\\R"], "\\mathbb{R}")
        self.assertEqual(macros["\\floor"], "\\lfloor #1 \\rfloor")
        self.assertEqual(macros["\\epsilon"], "\\varepsilon")
        self.assertEqual(macros["\\old"], "\\operatorname{old}(#1)")
        self.assertEqual(macros["\\alias"], "\\mathbb{R}")
        self.assertEqual(macros["\\supp"], "\\operatorname{supp}")


if __name__ == "__main__":
    unittest.main()
