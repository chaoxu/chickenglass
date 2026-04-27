import type { SyntaxNode, Tree } from "@lezer/common";
import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

export type LinkReferenceMap = ReadonlyMap<string, string>;

export function normalizeLinkReferenceLabel(label: string): string {
  return label
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

type DocumentSlice = (from: number, to: number) => string;

function collectFromTree(tree: Tree | SyntaxNode, sliceDoc: DocumentSlice): LinkReferenceMap {
  const references = new Map<string, string>();
  const root = "topNode" in tree ? tree.topNode : tree;

  const visit = (node: SyntaxNode): void => {
    if (node.name === "LinkReference") {
      const labelNode = node.getChild("LinkLabel");
      const urlNode = node.getChild("URL");
      if (!labelNode || !urlNode) return;
      const label = normalizeLinkReferenceLabel(sliceDoc(labelNode.from, labelNode.to));
      if (label && !references.has(label)) {
        references.set(label, sliceDoc(urlNode.from, urlNode.to).trim());
      }
      return;
    }

    let child = node.firstChild;
    while (child) {
      visit(child);
      child = child.nextSibling;
    }
  };

  visit(root);
  return references;
}

export function collectLinkReferencesFromTree(
  tree: Tree | SyntaxNode,
  doc: string,
): LinkReferenceMap {
  return collectFromTree(tree, (from, to) => doc.slice(from, to));
}

export function collectLinkReferencesFromState(state: EditorState): LinkReferenceMap {
  return collectFromTree(syntaxTree(state), (from, to) => state.sliceDoc(from, to));
}

export function resolveLinkReference(
  references: LinkReferenceMap,
  label: string,
): string | undefined {
  return references.get(normalizeLinkReferenceLabel(label));
}
