import type { SyntaxNode } from "@lezer/common";
import { NODE } from "../constants/node-types";

interface NamedSyntaxNode {
  readonly name: string;
}

const HEADING_NAMES = new Set<string>([
  NODE.ATXHeading1,
  NODE.ATXHeading2,
  NODE.ATXHeading3,
  NODE.ATXHeading4,
  NODE.ATXHeading5,
  NODE.ATXHeading6,
  NODE.SetextHeading1,
  NODE.SetextHeading2,
]);

function hasNodeName(
  node: NamedSyntaxNode | null | undefined,
  name: string,
): boolean {
  return node?.name === name;
}

export function findAncestor(
  node: SyntaxNode | null,
  predicate: (candidate: SyntaxNode) => boolean,
): SyntaxNode | null {
  let current = node;
  while (current) {
    if (predicate(current)) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

export function findAncestorByName(
  node: SyntaxNode | null,
  name: string,
): SyntaxNode | null {
  return findAncestor(node, (candidate) => candidate.name === name);
}

export function isDisplayMath(node: NamedSyntaxNode | null | undefined): boolean {
  return hasNodeName(node, NODE.DisplayMath);
}

export function isFencedCode(node: NamedSyntaxNode | null | undefined): boolean {
  return hasNodeName(node, NODE.FencedCode);
}

export function isFencedDiv(node: NamedSyntaxNode | null | undefined): boolean {
  return hasNodeName(node, NODE.FencedDiv);
}

export function isFencedDivFence(node: NamedSyntaxNode | null | undefined): boolean {
  return hasNodeName(node, NODE.FencedDivFence);
}

export function isHeading(node: NamedSyntaxNode | null | undefined): boolean {
  return node ? HEADING_NAMES.has(node.name) : false;
}

export function isInlineMath(node: NamedSyntaxNode | null | undefined): boolean {
  return hasNodeName(node, NODE.InlineMath);
}

export function isMath(node: NamedSyntaxNode | null | undefined): boolean {
  return isInlineMath(node) || isDisplayMath(node);
}
