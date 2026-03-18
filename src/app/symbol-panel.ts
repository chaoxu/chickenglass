import type { EditorView } from "@codemirror/view";

/** A single math symbol entry. */
export interface MathSymbol {
  /** LaTeX command, e.g. `\\alpha`. */
  latex: string;
  /** Unicode character for display, e.g. `α`. */
  display: string;
  /** Human-readable label, e.g. `alpha`. */
  label: string;
}

/** A named category of math symbols. */
export interface SymbolCategory {
  name: string;
  symbols: MathSymbol[];
}

/** All symbol categories shown in the panel. */
export const SYMBOL_CATEGORIES: SymbolCategory[] = [
  {
    name: "Greek",
    symbols: [
      { latex: "\\alpha", display: "α", label: "alpha" },
      { latex: "\\beta", display: "β", label: "beta" },
      { latex: "\\gamma", display: "γ", label: "gamma" },
      { latex: "\\delta", display: "δ", label: "delta" },
      { latex: "\\epsilon", display: "ε", label: "epsilon" },
      { latex: "\\varepsilon", display: "ε", label: "varepsilon" },
      { latex: "\\zeta", display: "ζ", label: "zeta" },
      { latex: "\\eta", display: "η", label: "eta" },
      { latex: "\\theta", display: "θ", label: "theta" },
      { latex: "\\vartheta", display: "ϑ", label: "vartheta" },
      { latex: "\\iota", display: "ι", label: "iota" },
      { latex: "\\kappa", display: "κ", label: "kappa" },
      { latex: "\\lambda", display: "λ", label: "lambda" },
      { latex: "\\mu", display: "μ", label: "mu" },
      { latex: "\\nu", display: "ν", label: "nu" },
      { latex: "\\xi", display: "ξ", label: "xi" },
      { latex: "\\pi", display: "π", label: "pi" },
      { latex: "\\varpi", display: "ϖ", label: "varpi" },
      { latex: "\\rho", display: "ρ", label: "rho" },
      { latex: "\\varrho", display: "ϱ", label: "varrho" },
      { latex: "\\sigma", display: "σ", label: "sigma" },
      { latex: "\\varsigma", display: "ς", label: "varsigma" },
      { latex: "\\tau", display: "τ", label: "tau" },
      { latex: "\\upsilon", display: "υ", label: "upsilon" },
      { latex: "\\phi", display: "φ", label: "phi" },
      { latex: "\\varphi", display: "φ", label: "varphi" },
      { latex: "\\chi", display: "χ", label: "chi" },
      { latex: "\\psi", display: "ψ", label: "psi" },
      { latex: "\\omega", display: "ω", label: "omega" },
      { latex: "\\Gamma", display: "Γ", label: "Gamma" },
      { latex: "\\Delta", display: "Δ", label: "Delta" },
      { latex: "\\Theta", display: "Θ", label: "Theta" },
      { latex: "\\Lambda", display: "Λ", label: "Lambda" },
      { latex: "\\Xi", display: "Ξ", label: "Xi" },
      { latex: "\\Pi", display: "Π", label: "Pi" },
      { latex: "\\Sigma", display: "Σ", label: "Sigma" },
      { latex: "\\Upsilon", display: "Υ", label: "Upsilon" },
      { latex: "\\Phi", display: "Φ", label: "Phi" },
      { latex: "\\Psi", display: "Ψ", label: "Psi" },
      { latex: "\\Omega", display: "Ω", label: "Omega" },
    ],
  },
  {
    name: "Operators",
    symbols: [
      { latex: "\\sum", display: "∑", label: "sum" },
      { latex: "\\prod", display: "∏", label: "prod" },
      { latex: "\\int", display: "∫", label: "int" },
      { latex: "\\oint", display: "∮", label: "oint" },
      { latex: "\\iint", display: "∬", label: "iint" },
      { latex: "\\iiint", display: "∭", label: "iiint" },
      { latex: "\\partial", display: "∂", label: "partial" },
      { latex: "\\nabla", display: "∇", label: "nabla" },
      { latex: "\\infty", display: "∞", label: "infty" },
      { latex: "\\pm", display: "±", label: "pm" },
      { latex: "\\mp", display: "∓", label: "mp" },
      { latex: "\\times", display: "×", label: "times" },
      { latex: "\\div", display: "÷", label: "div" },
      { latex: "\\cdot", display: "·", label: "cdot" },
      { latex: "\\circ", display: "∘", label: "circ" },
      { latex: "\\bullet", display: "•", label: "bullet" },
      { latex: "\\oplus", display: "⊕", label: "oplus" },
      { latex: "\\otimes", display: "⊗", label: "otimes" },
      { latex: "\\ominus", display: "⊖", label: "ominus" },
      { latex: "\\oslash", display: "⊘", label: "oslash" },
      { latex: "\\wedge", display: "∧", label: "wedge" },
      { latex: "\\vee", display: "∨", label: "vee" },
      { latex: "\\cap", display: "∩", label: "cap" },
      { latex: "\\cup", display: "∪", label: "cup" },
      { latex: "\\sqcap", display: "⊓", label: "sqcap" },
      { latex: "\\sqcup", display: "⊔", label: "sqcup" },
    ],
  },
  {
    name: "Relations",
    symbols: [
      { latex: "\\leq", display: "≤", label: "leq" },
      { latex: "\\geq", display: "≥", label: "geq" },
      { latex: "\\neq", display: "≠", label: "neq" },
      { latex: "\\approx", display: "≈", label: "approx" },
      { latex: "\\equiv", display: "≡", label: "equiv" },
      { latex: "\\sim", display: "∼", label: "sim" },
      { latex: "\\simeq", display: "≃", label: "simeq" },
      { latex: "\\cong", display: "≅", label: "cong" },
      { latex: "\\propto", display: "∝", label: "propto" },
      { latex: "\\in", display: "∈", label: "in" },
      { latex: "\\notin", display: "∉", label: "notin" },
      { latex: "\\ni", display: "∋", label: "ni" },
      { latex: "\\subset", display: "⊂", label: "subset" },
      { latex: "\\supset", display: "⊃", label: "supset" },
      { latex: "\\subseteq", display: "⊆", label: "subseteq" },
      { latex: "\\supseteq", display: "⊇", label: "supseteq" },
      { latex: "\\ll", display: "≪", label: "ll" },
      { latex: "\\gg", display: "≫", label: "gg" },
      { latex: "\\perp", display: "⊥", label: "perp" },
      { latex: "\\parallel", display: "∥", label: "parallel" },
      { latex: "\\mid", display: "∣", label: "mid" },
      { latex: "\\nmid", display: "∤", label: "nmid" },
      { latex: "\\models", display: "⊨", label: "models" },
      { latex: "\\vdash", display: "⊢", label: "vdash" },
      { latex: "\\dashv", display: "⊣", label: "dashv" },
      { latex: "\\prec", display: "≺", label: "prec" },
      { latex: "\\succ", display: "≻", label: "succ" },
    ],
  },
  {
    name: "Arrows",
    symbols: [
      { latex: "\\to", display: "→", label: "to" },
      { latex: "\\leftarrow", display: "←", label: "leftarrow" },
      { latex: "\\leftrightarrow", display: "↔", label: "leftrightarrow" },
      { latex: "\\Rightarrow", display: "⇒", label: "Rightarrow" },
      { latex: "\\Leftarrow", display: "⇐", label: "Leftarrow" },
      { latex: "\\Leftrightarrow", display: "⇔", label: "Leftrightarrow" },
      { latex: "\\mapsto", display: "↦", label: "mapsto" },
      { latex: "\\hookrightarrow", display: "↪", label: "hookrightarrow" },
      { latex: "\\hookleftarrow", display: "↩", label: "hookleftarrow" },
      { latex: "\\twoheadrightarrow", display: "↠", label: "twoheadrightarrow" },
      { latex: "\\uparrow", display: "↑", label: "uparrow" },
      { latex: "\\downarrow", display: "↓", label: "downarrow" },
      { latex: "\\updownarrow", display: "↕", label: "updownarrow" },
      { latex: "\\Uparrow", display: "⇑", label: "Uparrow" },
      { latex: "\\Downarrow", display: "⇓", label: "Downarrow" },
      { latex: "\\nearrow", display: "↗", label: "nearrow" },
      { latex: "\\searrow", display: "↘", label: "searrow" },
      { latex: "\\swarrow", display: "↙", label: "swarrow" },
      { latex: "\\nwarrow", display: "↖", label: "nwarrow" },
      { latex: "\\longrightarrow", display: "⟶", label: "longrightarrow" },
      { latex: "\\longleftarrow", display: "⟵", label: "longleftarrow" },
      { latex: "\\longleftrightarrow", display: "⟷", label: "longleftrightarrow" },
      { latex: "\\Longrightarrow", display: "⟹", label: "Longrightarrow" },
      { latex: "\\Longleftarrow", display: "⟸", label: "Longleftarrow" },
      { latex: "\\longmapsto", display: "⟼", label: "longmapsto" },
    ],
  },
  {
    name: "Misc",
    symbols: [
      { latex: "\\forall", display: "∀", label: "forall" },
      { latex: "\\exists", display: "∃", label: "exists" },
      { latex: "\\nexists", display: "∄", label: "nexists" },
      { latex: "\\neg", display: "¬", label: "neg" },
      { latex: "\\emptyset", display: "∅", label: "emptyset" },
      { latex: "\\varnothing", display: "∅", label: "varnothing" },
      { latex: "\\mathbb{R}", display: "ℝ", label: "mathbb R" },
      { latex: "\\mathbb{N}", display: "ℕ", label: "mathbb N" },
      { latex: "\\mathbb{Z}", display: "ℤ", label: "mathbb Z" },
      { latex: "\\mathbb{Q}", display: "ℚ", label: "mathbb Q" },
      { latex: "\\mathbb{C}", display: "ℂ", label: "mathbb C" },
      { latex: "\\hbar", display: "ℏ", label: "hbar" },
      { latex: "\\ell", display: "ℓ", label: "ell" },
      { latex: "\\Re", display: "ℜ", label: "Re" },
      { latex: "\\Im", display: "ℑ", label: "Im" },
      { latex: "\\aleph", display: "ℵ", label: "aleph" },
      { latex: "\\angle", display: "∠", label: "angle" },
      { latex: "\\triangle", display: "△", label: "triangle" },
      { latex: "\\square", display: "□", label: "square" },
      { latex: "\\lfloor", display: "⌊", label: "lfloor" },
      { latex: "\\rfloor", display: "⌋", label: "rfloor" },
      { latex: "\\lceil", display: "⌈", label: "lceil" },
      { latex: "\\rceil", display: "⌉", label: "rceil" },
      { latex: "\\ldots", display: "…", label: "ldots" },
      { latex: "\\cdots", display: "⋯", label: "cdots" },
      { latex: "\\vdots", display: "⋮", label: "vdots" },
      { latex: "\\ddots", display: "⋱", label: "ddots" },
    ],
  },
];

/**
 * Insert a LaTeX symbol into the editor at the current cursor position.
 * If the cursor is inside inline math delimiters (`$...$`), inserts bare LaTeX.
 * Otherwise wraps in `$...$`.
 *
 * Note: the math-context check counts unescaped `$` on the current line only.
 * It does not handle `$$`, `\(`, `\[`, or escaped `\$`.  This is intentional
 * for simplicity; inserting inside a display-math block will wrap in `$...$`
 * which is harmless in practice.
 */
export function insertSymbol(view: EditorView, latex: string): void {
  const { state } = view;
  const { from } = state.selection.main;

  // Scan only the current line up to the cursor to avoid slicing the whole doc.
  const line = state.doc.lineAt(from);
  const textBefore = state.doc.sliceString(line.from, from);
  const dollarCount = (textBefore.match(/\$/g) ?? []).length;
  const inMath = dollarCount % 2 === 1;

  const insertion = inMath ? latex : `$${latex}$`;

  view.dispatch({
    changes: { from, to: state.selection.main.to, insert: insertion },
    selection: { anchor: from + insertion.length },
  });
  view.focus();
}

/** Sidebar panel that shows categorized math symbols with search/filter. */
export class SymbolPanel {
  readonly element: HTMLElement;
  private currentView: EditorView | null = null;
  private searchQuery = "";

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "symbol-panel";
    this.render();
  }

  /** Set the editor view to insert symbols into. */
  setView(view: EditorView | null): void {
    this.currentView = view;
  }

  private render(): void {
    this.element.innerHTML = "";

    // Search box
    const searchWrapper = document.createElement("div");
    searchWrapper.className = "symbol-panel-search-wrapper";

    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.className = "symbol-panel-search";
    searchInput.placeholder = "Search symbols…";
    searchInput.value = this.searchQuery;
    searchInput.addEventListener("input", () => {
      this.searchQuery = searchInput.value;
      this.renderCategories(categoriesContainer);
    });
    searchWrapper.appendChild(searchInput);
    this.element.appendChild(searchWrapper);

    // Categories container
    const categoriesContainer = document.createElement("div");
    categoriesContainer.className = "symbol-panel-categories";
    this.element.appendChild(categoriesContainer);

    this.renderCategories(categoriesContainer);
  }

  private renderCategories(container: HTMLElement): void {
    container.innerHTML = "";

    const query = this.searchQuery.toLowerCase().trim();

    for (const category of SYMBOL_CATEGORIES) {
      const filtered = query
        ? category.symbols.filter(
            (s) =>
              s.label.toLowerCase().includes(query) ||
              s.latex.toLowerCase().includes(query) ||
              s.display.includes(query),
          )
        : category.symbols;

      if (filtered.length === 0) continue;

      const section = document.createElement("div");
      section.className = "symbol-panel-section";

      const heading = document.createElement("div");
      heading.className = "symbol-panel-heading";
      heading.textContent = category.name;
      section.appendChild(heading);

      const grid = document.createElement("div");
      grid.className = "symbol-panel-grid";

      for (const sym of filtered) {
        const btn = document.createElement("button");
        btn.className = "symbol-panel-btn";
        btn.textContent = sym.display;
        btn.title = `${sym.label} (${sym.latex})`;
        btn.addEventListener("mousedown", (e) => {
          // Prevent the click from stealing focus from the editor
          e.preventDefault();
          if (this.currentView) {
            insertSymbol(this.currentView, sym.latex);
          }
        });
        grid.appendChild(btn);
      }

      section.appendChild(grid);
      container.appendChild(section);
    }

    if (container.children.length === 0 && query) {
      const empty = document.createElement("div");
      empty.className = "symbol-panel-empty";
      empty.textContent = "No symbols found.";
      container.appendChild(empty);
    }
  }
}
