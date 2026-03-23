import { uint8ArrayToBase64 } from "./lib/utils";
import { getBlogFiles } from "./demo-blog";

// Re-export canonical types from src/lib/types.ts so that existing
// `from "./file-manager"` / `from "../file-manager"` imports keep working.
export type { FileEntry, FileSystem } from "../lib/types";

// Local import for use in this file's implementation.
import type { FileEntry, FileSystem } from "../lib/types";

/** In-memory filesystem for demo/testing purposes. */
export class MemoryFileSystem implements FileSystem {
  private readonly files: Map<string, string>;
  /** Tracks explicitly created directories (not just inferred from file paths). */
  private readonly dirs: Set<string>;

  constructor(initialFiles?: Record<string, string>) {
    this.files = new Map(Object.entries(initialFiles ?? {}));
    this.dirs = new Set();
  }

  async listTree(): Promise<FileEntry> {
    const root: FileEntry = {
      name: "project",
      path: "",
      isDirectory: true,
      children: [],
    };

    /** Ensure all ancestor directory nodes exist and return the leaf's parent. */
    const ensureDirNode = (parts: string[]): FileEntry => {
      let current = root;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const partialPath = parts.slice(0, i + 1).join("/");
        if (!current.children) current.children = [];
        let node = current.children.find((c) => c.name === part);
        if (!node) {
          node = { name: part, path: partialPath, isDirectory: true, children: [] };
          current.children.push(node);
        }
        current = node;
      }
      return current;
    };

    // Materialise explicitly created empty directories first
    for (const dirPath of [...this.dirs].sort()) {
      const parts = dirPath.split("/");
      const parentParts = parts.slice(0, -1);
      const dirName = parts[parts.length - 1];
      const parent = ensureDirNode(parentParts);
      if (!parent.children) parent.children = [];
      if (!parent.children.find((c) => c.name === dirName)) {
        parent.children.push({ name: dirName, path: dirPath, isDirectory: true, children: [] });
      }
    }

    // Add files, creating ancestor directory nodes as needed
    for (const filePath of [...this.files.keys()].sort()) {
      const parts = filePath.split("/");
      const fileName = parts[parts.length - 1];
      const parentParts = parts.slice(0, -1);
      const parent = ensureDirNode(parentParts);
      if (!parent.children) parent.children = [];
      if (!parent.children.find((c) => c.name === fileName)) {
        parent.children.push({ name: fileName, path: filePath, isDirectory: false });
      }
    }

    sortTree(root);
    return root;
  }

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (!this.files.has(path)) {
      throw new Error(`File not found: ${path}`);
    }
    this.files.set(path, content);
  }

  async createFile(path: string, content?: string): Promise<void> {
    if (this.files.has(path)) {
      throw new Error(`File already exists: ${path}`);
    }
    this.files.set(path, content ?? "");
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    const content = this.files.get(oldPath);
    if (content === undefined) {
      throw new Error(`File not found: ${oldPath}`);
    }
    if (this.files.has(newPath)) {
      throw new Error(`File already exists: ${newPath}`);
    }
    this.files.delete(oldPath);
    this.files.set(newPath, content);
  }

  async createDirectory(path: string): Promise<void> {
    if (this.dirs.has(path)) {
      throw new Error(`Directory already exists: ${path}`);
    }
    // A "directory" is also implicitly present if any file lives inside it
    const prefix = path + "/";
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) {
        throw new Error(`Directory already exists: ${path}`);
      }
    }
    this.dirs.add(path);
  }

  async writeFileBinary(path: string, data: Uint8Array): Promise<void> {
    // In memory mode, store binary data as a base64 string.
    // Ensure parent directories exist.
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dirPath = parts.slice(0, i).join("/");
      if (!this.dirs.has(dirPath)) {
        this.dirs.add(dirPath);
      }
    }
    this.files.set(path, uint8ArrayToBase64(data));
  }

  async deleteFile(path: string): Promise<void> {
    // Check if it's a file first
    if (this.files.has(path)) {
      this.files.delete(path);
      return;
    }

    // Check if it's a directory (explicit or implicit via children)
    const prefix = path + "/";
    let found = this.dirs.has(path);
    if (!found) {
      for (const key of this.files.keys()) {
        if (key.startsWith(prefix)) {
          found = true;
          break;
        }
      }
    }

    if (!found) {
      throw new Error(`File not found: ${path}`);
    }

    // Delete the directory and all its children
    this.dirs.delete(path);
    for (const dir of [...this.dirs]) {
      if (dir.startsWith(prefix)) this.dirs.delete(dir);
    }
    for (const key of [...this.files.keys()]) {
      if (key.startsWith(prefix)) this.files.delete(key);
    }
  }
}

/** Sort a file tree: directories first, then alphabetical. */
function sortTree(entry: FileEntry): void {
  if (!entry.children) return;
  entry.children.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
  for (const child of entry.children) {
    sortTree(child);
  }
}

/** Create a demo filesystem with sample markdown files. */
export function createDemoFileSystem(): MemoryFileSystem {
  return new MemoryFileSystem({
    "coflat.yaml": `# Project configuration — shared settings inherited by all documents.
# Per-file frontmatter can override any of these.
bibliography: refs.bib
math:
  \\R: "\\\\mathbb{R}"
  \\N: "\\\\mathbb{N}"
  \\Z: "\\\\mathbb{Z}"
  \\Q: "\\\\mathbb{Q}"
  \\F: "\\\\mathbb{F}"
  \\e: "\\\\varepsilon"
  \\set: "\\\\left\\\\{#1\\\\right\\\\}"
  \\ceil: "\\\\left\\\\lceil#1\\\\right\\\\rceil"
  \\floor: "\\\\left\\\\lfloor#1\\\\right\\\\rfloor"
  \\bm: "\\\\boldsymbol{#1}"
`,
    "main.md": `---
title: Coflat Demo
---

A semantic document editor for **mathematical writing**. It supports *Typora-style* inline rendering, ~~strikethrough~~, ==highlights==, and \`inline code\`.

::: {.include}
chapters/introduction.md
:::

# Math

The Euler identity $e^{i\\pi} + 1 = 0$ unites five fundamental constants. Custom macros work too: $\\R$, $\\N$, $\\Z$.

Display math with equation labels:

$$
\\int_0^\\infty e^{-x^2} \\, dx = \\frac{\\sqrt{\\pi}}{2}
$$ {#eq:gaussian}

$$
\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}
$$ {#eq:sum}

# Theorems & Proofs

::: {.theorem #thm-evt} Extreme Value Theorem
Every continuous function $f: [a,b] \\to \\R$ attains its maximum and minimum.
:::

::: {.proof}
Since $[a,b]$ is compact and $f$ is continuous, $f([a,b])$ is compact in $\\R$, hence closed and bounded. By the least upper bound property, the supremum is attained.
:::

::: {.lemma #lem-compact}
A continuous image of a compact set is compact.
:::

::: {.definition #def-compact}
A set $K \\subseteq \\R$ is **compact** if every open cover of $K$ has a finite subcover.
:::

::: {.corollary #cor-bounded}
Every continuous function on a closed interval is bounded.
:::

::: Theorem Bolzano-Weierstrass
Every bounded sequence in $\\R$ has a convergent subsequence.
:::

::: {.problem #prob-macros} Custom Macros
Show that $\\set{x \\in \\R : \\floor{x} = \\ceil{x}}$ equals $\\Z$, and that for any $\\e > 0$ there exists $n \\in \\N$ with $1/n < \\e$.
:::

::: {.corollary} Every continuous function on a closed interval is bounded. :::

::: {.remark} The converse of the Extreme Value Theorem is false. :::

# Cross-References

See [@thm-evt] for the main result, which relies on [@lem-compact]. The key definition is [@def-compact]. The Gaussian integral is [@eq:gaussian], and the summation formula is [@eq:sum].

# Citations

Minimum cuts can be computed efficiently [@karger2000]. As shown by @cormen2009, graph algorithms are fundamental to computer science. For classic references on algorithm analysis, see [@knuth1997; @karger2000].

# Lists

Key concepts:

- **Compactness** in $\\R$: closed and bounded (Heine-Borel)
- **Continuity**: preserves limits
  - Uniform continuity: $\\delta$ independent of $x$
  - Lipschitz continuity: bounded derivative
    - Every Lipschitz function is uniformly continuous
- **Connectedness**: cannot be split into disjoint open sets

Steps to prove the Extreme Value Theorem:

1. Show $f([a,b])$ is compact
2. Conclude it is closed and bounded
3. The supremum exists and is attained

Task list:

- [x] Implement math rendering
- [x] Add theorem environments
- [ ] Export to PDF via Pandoc
- [ ] Add real-time collaboration

# Tables

| Property      | Symbol        | Description                              |
| :------------ | :-----------: | ---------------------------------------: |
| Natural nums  | $\\N$         | Counting numbers $\\{1, 2, 3, \\ldots\\}$ |
| Integers      | $\\Z$         | $\\{\\ldots, -1, 0, 1, \\ldots\\}$        |
| Reals         | $\\R$         | The complete ordered field               |
| Euler's       | $e^{i\\pi}$   | The most beautiful identity              |

# Code

\`\`\`typescript
function isPrime(n: number): boolean {
  if (n <= 1) return false;
  for (let i = 2; i * i <= n; i++) {
    if (n % i === 0) return false;
  }
  return true;
}
\`\`\`

# Sidenotes

The Extreme Value Theorem[^evt] is fundamental to real analysis. Compactness[^compact] plays a key role in the proof.

[^evt]: First proved by Weierstrass. Every continuous function $f: [a,b] \\to \\R$ attains its **maximum** and **minimum**.
[^compact]: A set is compact if every open cover has a finite subcover. In $\\R^n$, this is equivalent to being closed and bounded.

# Blockquote

> Mathematics is the queen of the sciences and number theory is the queen of mathematics.
> — Carl Friedrich Gauss

> The identity $e^{i\\pi} + 1 = 0$ unites five constants. For any $f: [a,b] \\to \\mathbb{R}$, the integral $\\int_a^b f(x)\\,dx$ measures signed area.

---

::: {.include}
chapters/background.md
:::
`,
    "refs.bib": `@article{karger2000,
  author = {David R. Karger},
  title = {Minimum Cuts in Near-Linear Time},
  journal = {Journal of the ACM},
  volume = {47},
  number = {1},
  pages = {46--76},
  year = {2000}
}

@book{cormen2009,
  author = {Thomas H. Cormen and Charles E. Leiserson and Ronald L. Rivest and Clifford Stein},
  title = {Introduction to Algorithms},
  publisher = {MIT Press},
  year = {2009},
  edition = {3rd}
}

@book{knuth1997,
  author = {Donald E. Knuth},
  title = {The Art of Computer Programming},
  publisher = {Addison-Wesley},
  year = {1997},
  volume = {1}
}
`,
    "notes.md": `# Research Notes

## Open Problems

- Can we achieve $O(n \\log n)$ minimum cut?
- Derandomization of Karger's algorithm
- Extension to **weighted** graphs

## Reading List

1. @karger2000 — the foundational paper
2. @cormen2009 — Chapter 26 on maximum flow
3. [@knuth1997] — Volume 1, fundamental algorithms
`,
    "chapters/introduction.md": `# Introduction

This document demonstrates the features of Coflat, a semantic editor for mathematical writing. The editor provides:

- **Typora-style rendering**: source revealed only where you click
- **KaTeX math**: inline $x^2$ and display mode with equation labels
- **Theorem environments**: fenced divs with automatic numbering
- **Cross-references**: click-to-navigate between theorems, equations, and citations
- **CSL citations**: formatted bibliography from BibTeX files
- **File includes**: compose documents from multiple files seamlessly
`,
    "chapters/background.md": `# Background

## Compactness

The notion of compactness is central to analysis. In $\\R^n$, the Heine-Borel theorem states that a set is compact if and only if it is closed and bounded.

::: {.theorem #thm-heine-borel} Heine-Borel
A subset of $\\R^n$ is compact if and only if it is closed and bounded.
:::

## Continuity

::: {.definition #def-continuous} Continuity of $f: X \\to Y$
A function $f$ is **continuous** at $x_0$ if for every $\\varepsilon > 0$ there exists $\\delta > 0$ such that $d(x, x_0) < \\delta$ implies $d(f(x), f(x_0)) < \\varepsilon$.
:::

This is equivalent to requiring that preimages of open sets are open.
`,
  });
}

/** Create a demo filesystem with the blog project. */
export function createBlogDemoFileSystem(): MemoryFileSystem {
  return new MemoryFileSystem(getBlogFiles());
}
