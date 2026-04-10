import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import {
  EditorState,
  type Range,
  type Transaction,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
} from "@codemirror/view";
import { __iconNode as checkIconNode } from "lucide-react/dist/esm/icons/check.js";
import { __iconNode as copyIconNode } from "lucide-react/dist/esm/icons/copy.js";
import { COPY_RESET_MS } from "../constants";
import { CSS } from "../constants/css-classes";
import { activeCodeBlockOpenFenceStarts } from "../editor/shell-ownership";
import { isFencedCode } from "../lib/syntax-tree-helpers";
import {
  activateStructureEditAt,
  hasStructureEditEffect,
  isCodeFenceStructureEditActive,
} from "../editor/structure-edit-state";
import {
  type CodeBlockInfo,
  collectCodeBlocks,
  getCodeBlockStructureRevision,
} from "../state/code-block-structure";
import { pushWidgetDecoration } from "./decoration-core";
import { createDecorationStateField } from "./decoration-field";
import {
  buildFencedBlockDecorations,
  type FencedBlockRenderContext,
  getFencedBlockRenderContext,
  hideMultiLineClosingFence,
} from "./fenced-block-core";
import {
  editorFocusField,
  focusEffect,
} from "./focus-state";
import { makeTextElement } from "./widget-core";
import { ShellWidget } from "./shell-widget";
import { createChangeChecker } from "../state/change-detection";

type IconNode = ReadonlyArray<readonly [string, Readonly<Record<string, string>>]>;

function createLucideIcon(iconNode: IconNode): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("xmlns", ns);
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "24");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("lucide");

  for (const [tag, attrs] of iconNode) {
    const child = document.createElementNS(ns, tag);
    for (const [name, value] of Object.entries(attrs)) {
      if (name === "key") continue;
      child.setAttribute(name, value);
    }
    svg.appendChild(child);
  }

  return svg;
}

/** Widget that renders a copy-to-clipboard button in the code block header. */
class CopyButtonWidget extends ShellWidget {
  private resetTimer: ReturnType<typeof setTimeout> | null = null;
  private buttonEl: HTMLButtonElement | null = null;

  constructor(private readonly code: string) {
    super();
  }

  private clearResetTimer(): void {
    const timer = this.resetTimer;
    this.resetTimer = null;
    if (timer !== null) clearTimeout(timer);
  }

  private getLiveButton(expected: HTMLButtonElement): HTMLButtonElement | null {
    const button = this.buttonEl;
    if (!button || button !== expected || !button.isConnected) return null;
    return button;
  }

  toDOM(): HTMLElement {
    const btn = document.createElement("button");
    btn.className = "cf-codeblock-copy";
    btn.type = "button";
    btn.setAttribute("aria-label", "Copy code to clipboard");
    btn.appendChild(createLucideIcon(copyIconNode));
    this.buttonEl = btn;
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void navigator.clipboard.writeText(this.code).then(() => {
        const button = this.getLiveButton(btn);
        if (!button) return;
        button.replaceChildren(createLucideIcon(checkIconNode));
        button.setAttribute("aria-label", "Copied");
        this.clearResetTimer();
        this.resetTimer = setTimeout(() => {
          this.resetTimer = null;
          const liveButton = this.getLiveButton(btn);
          if (!liveButton) return;
          liveButton.replaceChildren(createLucideIcon(copyIconNode));
          liveButton.setAttribute("aria-label", "Copy code to clipboard");
        }, COPY_RESET_MS);
      }).catch((e: unknown) => {
        console.error("[code-block] clipboard write failed", e);
      });
    });
    return btn;
  }

  destroy(): void {
    this.clearResetTimer();
    this.buttonEl = null;
  }

  eq(other: CopyButtonWidget): boolean {
    return this.code === other.code;
  }
}

function joinClasses(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

const codeBlockStructureRevisionChanged = createChangeChecker(getCodeBlockStructureRevision);

class CodeBlockLanguageWidget extends ShellWidget {
  constructor(private readonly language: string) {
    super();
  }

  createDOM(): HTMLElement {
    return makeTextElement("span", CSS.codeblockLanguage, this.language);
  }

  protected override bindSourceReveal(
    el: HTMLElement,
    view: EditorView,
  ): void {
    el.style.cursor = "pointer";
    el.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.focus();
      activateStructureEditAt(view, this.sourceFrom);
    });
  }

  eq(other: CodeBlockLanguageWidget): boolean {
    return this.language === other.language;
  }
}

/** Decoration callback for a single code block. Shared by full and incremental paths. */
function decorateCodeBlock(
  context: FencedBlockRenderContext<CodeBlockInfo>,
  items: Range<Decoration>[],
  activeShellStarts: ReadonlySet<number>,
): void {
  const { state, block, openLine, closeLine, bodyLineCount } = context;
  const structureEditActive = isCodeFenceStructureEditActive(state, block);
  const activeShell = activeShellStarts.has(block.openFenceFrom);
  const openerIsBottom = activeShell && bodyLineCount === 0;

  // --- Opening fence ---
  items.push(
    Decoration.line({
      class: joinClasses(
        CSS.codeblockHeader,
        structureEditActive && CSS.codeblockSourceOpen,
        bodyLineCount === 0 && CSS.codeblockLast,
        activeShell && CSS.activeShell,
        activeShell && CSS.activeShellTop,
        openerIsBottom && CSS.activeShellBottom,
      ),
    }).range(block.openFenceFrom),
  );

  const codeText = bodyLineCount > 0
    ? state.doc.sliceString(
      state.doc.line(openLine.number + 1).from,
      state.doc.line(closeLine.number - 1).to,
    )
    : "";

  if (structureEditActive) {
    items.push(
      Decoration.mark({ class: CSS.codeblockSource }).range(
        block.openFenceFrom,
        block.openFenceTo,
      ),
    );
  } else {
    const languageWidget = new CodeBlockLanguageWidget(block.language);
    languageWidget.updateSourceRange(block.openFenceFrom, block.openFenceTo);
    pushWidgetDecoration(items, languageWidget, block.openFenceFrom, block.openFenceTo);
  }

  if (bodyLineCount > 0) {
    items.push(
      Decoration.widget({
        widget: new CopyButtonWidget(codeText),
        side: 1,
      }).range(block.openFenceFrom),
    );
  }

  // --- Body lines ---
  for (let ln = openLine.number + 1; ln < closeLine.number; ln++) {
    const line = state.doc.line(ln);
    const isLast = ln === closeLine.number - 1;
    items.push(
      Decoration.line({
        class: joinClasses(
          isLast ? CSS.codeblockLast : CSS.codeblockBody,
          activeShell && CSS.activeShell,
          activeShell && isLast && CSS.activeShellBottom,
        ),
      }).range(line.from),
    );
  }

  // --- Closing fence ---
  // Always hidden in rich mode regardless of cursor position (#429).
  // The closing fence is protected from accidental deletion by a
  // transaction filter and skipped by atomicRanges (see below).
  if (!block.singleLine) {
    hideMultiLineClosingFence(block.closeFenceFrom, block.closeFenceTo, items);
  }
}

/** Build decorations for all fenced code blocks. */
function buildCodeBlockDecorations(state: EditorState): DecorationSet {
  const activeShellStarts = activeCodeBlockOpenFenceStarts(state);
  return buildFencedBlockDecorations(state, collectCodeBlocks, (context, items) => {
    decorateCodeBlock(context, items, activeShellStarts);
  });
}

/**
 * Compute the dirty region in the new document that needs decoration rebuild.
 *
 * Expands the literal changed ranges to cover any FencedCode blocks that
 * overlap them in BOTH the old and new trees. This ensures that decorations
 * for destroyed blocks (present in old tree but absent in new) are removed,
 * and decorations for newly created blocks are added.
 */
export function computeCodeBlockDirtyRegion(
  tr: Transaction,
): { filterFrom: number; filterTo: number } | null {
  let filterFrom = Number.POSITIVE_INFINITY;
  let filterTo = Number.NEGATIVE_INFINITY;

  const oldTree = syntaxTree(tr.startState);
  const newTree = syntaxTree(tr.state);

  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    // Start with the literal changed range in the new document
    filterFrom = Math.min(filterFrom, fromB);
    filterTo = Math.max(filterTo, toB);

    // Expand for blocks in the OLD tree (mapped to new positions)
    oldTree.iterate({
      from: fromA,
      to: toA,
      enter(node) {
        if (isFencedCode(node)) {
          filterFrom = Math.min(filterFrom, tr.changes.mapPos(node.from));
          filterTo = Math.max(filterTo, tr.changes.mapPos(node.to));
          return false;
        }
      },
    });

    // Expand for blocks in the NEW tree
    newTree.iterate({
      from: fromB,
      to: toB,
      enter(node) {
        if (isFencedCode(node)) {
          filterFrom = Math.min(filterFrom, node.from);
          filterTo = Math.max(filterTo, node.to);
          return false;
        }
      },
    });
  });

  if (filterFrom > filterTo) return null;
  return { filterFrom, filterTo };
}

/** Build decoration items for code blocks overlapping a specific range. */
function buildCodeBlockItemsInRange(
  state: EditorState,
  rangeFrom: number,
  rangeTo: number,
): Range<Decoration>[] {
  const focused = state.field(editorFocusField, false) ?? false;
  const activeShellStarts = activeCodeBlockOpenFenceStarts(state);
  const items: Range<Decoration>[] = [];
  for (const block of collectCodeBlocks(state)) {
    if (block.to < rangeFrom) continue;
    if (block.from > rangeTo) break;
    decorateCodeBlock(
      getFencedBlockRenderContext(state, block, focused),
      items,
      activeShellStarts,
    );
  }

  return items;
}

/**
 * Incremental doc-change update: map existing decorations through changes,
 * then filter and rebuild only the dirty region.
 */
export function incrementalCodeBlockUpdate(
  value: DecorationSet,
  tr: Transaction,
): DecorationSet {
  const mapped = value.map(tr.changes);
  const dirty = computeCodeBlockDirtyRegion(tr);
  if (!dirty) return mapped;

  const { filterFrom, filterTo } = dirty;
  const newItems = buildCodeBlockItemsInRange(tr.state, filterFrom, filterTo);

  return mapped.update({
    filterFrom,
    filterTo,
    filter: () => false,
    add: newItems,
    sort: true,
  });
}

/**
 * CM6 StateField that provides code block rendering decorations.
 *
 * Uses a StateField so that line decorations (Decoration.line) are
 * permitted by CM6.
 *
 * On doc change with tree change: incremental rebuild scoped to the dirty
 * region (filterFrom/filterTo) instead of full-document rebuild (#723).
 * On doc change without tree change: maps decoration positions only.
 * On cursor/focus/tree-only change: full rebuild.
 */
export const codeBlockDecorationField = createDecorationStateField({
  create(state) {
    return buildCodeBlockDecorations(state);
  },

  update(value, tr) {
    if (
      tr.effects.some((e) => e.is(focusEffect)) ||
      hasStructureEditEffect(tr) ||
      codeBlockStructureRevisionChanged(tr)
    ) {
      return buildCodeBlockDecorations(tr.state);
    }

    if (tr.docChanged) {
      const treeChanged = syntaxTree(tr.state) !== syntaxTree(tr.startState);
      const treeReady = syntaxTreeAvailable(tr.state, tr.state.doc.length);

      if (treeChanged && treeReady) {
        return incrementalCodeBlockUpdate(value, tr);
      }
      return value.map(tr.changes);
    }

    if (
      tr.selection !== undefined ||
      (syntaxTree(tr.state) !== syntaxTree(tr.startState) &&
        syntaxTreeAvailable(tr.state, tr.state.doc.length))
    ) {
      return buildCodeBlockDecorations(tr.state);
    }

    return value;
  },
});
