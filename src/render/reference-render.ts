/**
 * Unified CM6 ViewPlugin for rendering all [@id] and @id references.
 *
 * Replaces the separate crossref-render and citation-render ViewPlugins
 * with a single tree walk that routes each reference to the appropriate
 * widget based on whether the id resolves as a block/equation crossref
 * or a bibliography citation.
 *
 * Widget classes (CrossrefWidget, CitationWidget, etc.) remain in their
 * original modules — this plugin only handles discovery and routing.
 */

import {
  type DecorationSet,
  type PluginValue,
  type ViewUpdate,
  ViewPlugin,
  Decoration,
  type EditorView,
} from "@codemirror/view";
import { type Extension, type Range } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { syntaxTree } from "@codemirror/language";
import {
  resolveCrossref,
  equationLabelsField,
} from "../index/crossref-resolver";
import {
  type BibStore,
  bibDataEffect,
  bibDataField,
  extractCitations,
  formatParenthetical,
  formatNarrativeCitation,
  CitationWidget,
} from "../citations/citation-render";
import { type CslProcessor, registerCitationsWithProcessor } from "../citations/csl-processor";
import { CrossrefWidget, UnresolvedRefWidget } from "./crossref-render";
import { buildDecorations, cursorInRange, type RenderWidget } from "./render-utils";

/**
 * Unified pattern for bracketed references inside Link nodes.
 *
 * Matches both:
 * - Single crossrefs: [@thm-1], [@eq:foo]
 * - Citations with locators: [@karger2000, chap. 3]
 * - Multi-citations: [@karger2000; @stein2001]
 *
 * This is a superset of the old BRACKETED_REF_RE and PAREN_CITE_RE.
 */
const BRACKETED_REF_RE =
  /^\[(@[a-zA-Z0-9_][\w:./''-]*(?:,[^;\]]*)?(?:\s*;\s*@[a-zA-Z0-9_][\w:./''-]*(?:,[^;\]]*)?)*)\]$/;

/** Pattern for narrative @id references in plain text. */
const NARRATIVE_REF_RE = /(?<![[@\w])@([a-zA-Z0-9_][\w:./''-]*\w)/g;

/** A reference match found during the unified tree walk. */
interface RefMatch {
  from: number;
  to: number;
  /** Whether this is a bracketed [@...] reference. */
  bracketed: boolean;
  /** Parsed ids (e.g., ["thm-1"] or ["karger2000", "stein2001"]). */
  ids: string[];
  /** Locator strings parallel to ids. */
  locators: (string | undefined)[];
}

/**
 * Single tree walk that finds all [@id] and @id references in the document.
 *
 * Returns matches sorted by document position. Does NOT filter by bibStore
 * membership — routing happens in the decoration builder.
 */
function findAllRefs(topNode: SyntaxNode, doc: string): RefMatch[] {
  const matches: RefMatch[] = [];
  const linkRanges: { from: number; to: number }[] = [];

  // 1. Walk tree for Link nodes
  topNode.cursor().iterate((node) => {
    if (node.name !== "Link") return;

    const text = doc.slice(node.from, node.to);
    const m = BRACKETED_REF_RE.exec(text);
    if (m) {
      const { ids, locators } = extractCitations(m[1]);
      matches.push({
        from: node.from,
        to: node.to,
        bracketed: true,
        ids,
        locators,
      });
    }

    linkRanges.push({ from: node.from, to: node.to });
  });

  // 2. Scan for narrative @id refs outside Link nodes
  NARRATIVE_REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NARRATIVE_REF_RE.exec(doc)) !== null) {
    const matchFrom = m.index;
    const matchTo = m.index + m[0].length;

    const insideLink = linkRanges.some(
      (r) => matchFrom >= r.from && matchTo <= r.to,
    );
    if (insideLink) continue;

    matches.push({
      from: matchFrom,
      to: matchTo,
      bracketed: false,
      ids: [m[1]],
      locators: [undefined],
    });
  }

  matches.sort((a, b) => a.from - b.from);
  return matches;
}

/** Push a widget replacement decoration, setting source range for click-to-edit. */
function pushWidget(
  items: Range<Decoration>[],
  widget: RenderWidget,
  from: number,
  to: number,
): void {
  widget.sourceFrom = from;
  widget.sourceTo = to;
  items.push(Decoration.replace({ widget }).range(from, to));
}

/**
 * Collect decoration ranges for all references (crossrefs + citations).
 *
 * Routing per match:
 * - Bracketed with bib id(s) → CitationWidget
 * - Bracketed single id, block/equation → CrossrefWidget
 * - Bracketed single id, unknown → UnresolvedRefWidget
 * - Narrative, block/equation → CrossrefWidget
 * - Narrative, bib id → CitationWidget (narrative style)
 */
export function collectReferenceRanges(
  view: EditorView,
  store: BibStore,
  cslProcessor?: CslProcessor | null,
): Range<Decoration>[] {
  const tree = syntaxTree(view.state);
  const doc = view.state.doc.toString();
  const equationLabels = view.state.field(equationLabelsField);
  const allRefs = findAllRefs(tree.topNode, doc);

  // Register citation clusters with CSL processor (needed for numeric styles)
  if (cslProcessor) {
    registerCitationsWithProcessor(
      allRefs
        .filter((ref) => ref.bracketed && ref.ids.some((id) => store.has(id)))
        .map((ref) => ({ parenthetical: true, ids: ref.ids, locators: ref.locators })),
      cslProcessor,
    );
  }

  const items: Range<Decoration>[] = [];

  for (const ref of allRefs) {
    if (cursorInRange(view, ref.from, ref.to)) continue;

    if (ref.bracketed) {
      const hasCitation = ref.ids.some((id) => store.has(id));

      if (hasCitation) {
        const rendered = cslProcessor
          ? cslProcessor.cite([...ref.ids], [...ref.locators])
          : formatParenthetical(ref.ids, store, ref.locators);
        pushWidget(items, new CitationWidget(rendered, ref.ids), ref.from, ref.to);
      } else if (ref.ids.length === 1) {
        const resolved = resolveCrossref(view.state, ref.ids[0], equationLabels);
        const raw = doc.slice(ref.from, ref.to);
        const widget = resolved.kind === "block" || resolved.kind === "equation"
          ? new CrossrefWidget(resolved, raw)
          : new UnresolvedRefWidget(raw);
        pushWidget(items, widget, ref.from, ref.to);
      }
    } else {
      // Narrative @id — crossref takes priority over citation
      const resolved = resolveCrossref(view.state, ref.ids[0], equationLabels);
      if (resolved.kind === "block" || resolved.kind === "equation") {
        const raw = doc.slice(ref.from, ref.to);
        pushWidget(items, new CrossrefWidget(resolved, raw), ref.from, ref.to);
      } else {
        const entry = store.get(ref.ids[0]);
        if (!entry) continue;
        const rendered = cslProcessor
          ? cslProcessor.citeNarrative(ref.ids[0])
          : formatNarrativeCitation(entry);
        pushWidget(items, new CitationWidget(rendered, ref.ids, true), ref.from, ref.to);
      }
    }
  }

  return items;
}

class ReferenceRenderPlugin implements PluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = this.buildAll(view);
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged ||
      update.focusChanged ||
      syntaxTree(update.state) !== syntaxTree(update.startState) ||
      update.transactions.some((tr) =>
        tr.effects.some((e) => e.is(bibDataEffect)),
      )
    ) {
      this.decorations = this.buildAll(update.view);
    }
  }

  private buildAll(view: EditorView): DecorationSet {
    const { store, cslProcessor } = view.state.field(bibDataField);
    return buildDecorations(collectReferenceRanges(view, store, cslProcessor));
  }
}

/** CM6 extension that renders all [@id] and @id references with Typora-style toggle. */
export const referenceRenderPlugin: Extension = ViewPlugin.fromClass(
  ReferenceRenderPlugin,
  {
    decorations: (v) => v.decorations,
  },
);
