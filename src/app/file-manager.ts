/** File entry representing a single file or directory in the tree. */
export interface FileEntry {
  /** File name (without path). */
  name: string;
  /** Full path from the project root. */
  path: string;
  /** Whether this entry is a directory. */
  isDirectory: boolean;
  /** Child entries (only populated for directories). */
  children?: FileEntry[];
}

/** Abstract filesystem interface for different backends. */
export interface FileSystem {
  /** List all files/directories as a tree starting from root. */
  listTree(): Promise<FileEntry>;
  /** Read the content of a file at the given path. */
  readFile(path: string): Promise<string>;
  /** Write content to a file at the given path. */
  writeFile(path: string, content: string): Promise<void>;
  /** Create a new file with optional initial content. */
  createFile(path: string, content?: string): Promise<void>;
  /** Check whether a file exists at the given path. */
  exists(path: string): Promise<boolean>;
}

/** In-memory filesystem for demo/testing purposes. */
export class MemoryFileSystem implements FileSystem {
  private readonly files: Map<string, string>;

  constructor(initialFiles?: Record<string, string>) {
    this.files = new Map(Object.entries(initialFiles ?? {}));
  }

  async listTree(): Promise<FileEntry> {
    const root: FileEntry = {
      name: "project",
      path: "",
      isDirectory: true,
      children: [],
    };

    const paths = [...this.files.keys()].sort();
    for (const filePath of paths) {
      const parts = filePath.split("/");
      let current = root;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const partialPath = parts.slice(0, i + 1).join("/");
        const isLast = i === parts.length - 1;

        if (!current.children) {
          current.children = [];
        }

        let existing = current.children.find((c) => c.name === part);
        if (!existing) {
          existing = {
            name: part,
            path: partialPath,
            isDirectory: !isLast,
            children: isLast ? undefined : [],
          };
          current.children.push(existing);
        }
        current = existing;
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
    "main.md": `---
title: Chickenglass Demo
bibliography: refs.bib
math:
  \\R: "\\\\mathbb{R}"
  \\N: "\\\\mathbb{N}"
---

# Chickenglass Demo

A semantic document editor for mathematical writing.

## Inline Math

The Euler identity $e^{i\\pi} + 1 = 0$ is elegant. Also $\\sum_{k=1}^n k$.

## Display Math

$$\\int_0^\\infty e^{-x^2} \\, dx = \\frac{\\sqrt{\\pi}}{2}$$

Multi-line display math:

$$
\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}
$$ {#eq:sum}

## Theorem Environment

::: {.theorem #thm-main} Fundamental Theorem
Every continuous function $f: [a,b] \\to \\R$ is bounded.
:::

::: {.proof}
Follows from compactness of $[a,b]$.
:::

::: {.lemma #lem-aux}
A useful lemma for the proof.
:::

::: {.definition #def-compact}
A set $K$ is **compact** if every open cover has a finite subcover.
:::

## Cross-References

See [@thm-main] and [@eq:sum] for details.

## Citations

Minimum cuts can be computed efficiently [@karger2000]. As shown by @cormen2009, graph algorithms are fundamental. See also [@knuth1997; @karger2000] for classic references.

## Lists

Unordered list:

- First item
- Second item with **bold** and *italic*
- Third item with $x^2 + y^2 = z^2$
  - Nested item
  - Another nested item
    - Deeply nested

Ordered list:

1. Step one
2. Step two
3. Step three

Task list:

- [ ] Write the introduction
- [x] Implement math rendering
- [ ] Add export to PDF

## Code Block

\`\`\`typescript
const greeting = "Hello, world!";
\`\`\`

## Included Content

::: {.include}
chapters/introduction.md
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
    "notes.md": `# Notes

Some quick notes for the project.
`,
    "chapters/introduction.md": `# Introduction

This chapter introduces the main concepts.
`,
    "chapters/background.md": `# Background

Background material goes here.
`,
  });
}
