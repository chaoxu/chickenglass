/**
 * Structured document intermediate representation (IR).
 *
 * Plain-data types that capture the semantic structure of a Coflat
 * markdown document. Derived from the Lezer syntax tree + Coflat
 * semantics layer, with no dependency on CM6, the editor, or the
 * render/plugin subsystems.
 *
 * Consumers: future AI features, document QA, structured export.
 */

/** Byte-offset range within the source document. */
export interface Range {
  readonly from: number;
  readonly to: number;
}

/** A heading-based section in the document. */
export interface SectionNode {
  readonly heading: string;
  readonly level: number;
  readonly range: Range;
  /** Hierarchical section number (e.g. "1.2"), empty string if unnumbered. */
  readonly number: string;
  /** Optional explicit id from Pandoc attributes (e.g. `{#sec:intro}`). */
  readonly id?: string;
  /** Nested sub-sections. */
  readonly children: readonly SectionNode[];
}

/**
 * A fenced-div block (theorem, proof, definition, remark, etc.).
 *
 * Represents `::: {.class #id} Title` ... `:::` regions.
 */
export interface BlockNode {
  /** Primary class from the fenced div attributes (e.g. "theorem"). */
  readonly type: string;
  /** Title text, if any. */
  readonly title?: string;
  /** Explicit label/id from attributes (e.g. "thm-main"). */
  readonly label?: string;
  /** Display number assigned by the shared block-numbering model, if numbered. */
  readonly number?: number;
  readonly range: Range;
  /** Raw body content between the opening and closing fences. */
  readonly content: string;
}

/** A display math equation with a label. */
export interface MathNode {
  /** LaTeX source (without delimiters). */
  readonly latex: string;
  /** Whether this is display math (true) or inline (false). */
  readonly display: boolean;
  /** Equation label (e.g. "eq:pyth"). Only present for labeled equations. */
  readonly label?: string;
  /** Sequential equation number (only for labeled display math). */
  readonly number?: number;
  readonly range: Range;
}

/** A cross-reference or citation. */
export interface ReferenceNode {
  /** Referenced ids (e.g. ["thm-main"] or ["eq:first", "eq:second"]). */
  readonly ids: readonly string[];
  readonly range: Range;
  /** Whether this is a bracketed reference ([@id]) vs narrative (@id). */
  readonly bracketed: boolean;
  /** Locator strings parallel to ids (e.g. "p. 5"), undefined when absent. */
  readonly locators: readonly (string | undefined)[];
}

/** A single table cell. */
export interface TableCellIR {
  /** Raw text content of the cell. */
  readonly content: string;
}

/** A table row (header or body). */
export interface TableRowIR {
  readonly cells: readonly TableCellIR[];
}

/** A markdown table. */
export interface TableNode {
  readonly header: TableRowIR;
  readonly rows: readonly TableRowIR[];
  readonly range: Range;
}

/** Frontmatter metadata extracted from YAML front matter. */
export interface DocumentMetadata {
  readonly title?: string;
  readonly author?: string;
  readonly date?: string;
  /** All raw key-value pairs from the frontmatter. */
  readonly raw: Readonly<Record<string, unknown>>;
}

/** Complete structured representation of a Coflat document. */
export interface DocumentIR {
  readonly metadata: DocumentMetadata;
  readonly sections: readonly SectionNode[];
  readonly blocks: readonly BlockNode[];
  readonly math: readonly MathNode[];
  readonly references: readonly ReferenceNode[];
  readonly tables: readonly TableNode[];
}
