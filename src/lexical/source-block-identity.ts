import { $getRoot, type LexicalEditor, type LexicalNode } from "lexical";

import {
  collectSourceBoundaryRanges,
  type SourceBoundaryRange,
  type SourceBoundaryRangeWithIndex,
  type SourceBoundaryVariant,
} from "../lib/markdown/block-scanner";

export interface LexicalSourceBlockIdentity {
  readonly from: number;
  readonly index: number;
  readonly raw: string;
  readonly to: number;
  readonly variant: SourceBoundaryVariant;
}

const sourceBlockIdentitiesByEditor = new WeakMap<
  LexicalEditor,
  Map<string, LexicalSourceBlockIdentity>
>();

function sourceBoundariesForIdentity(markdown: string): SourceBoundaryRange[] {
  return collectSourceBoundaryRanges(markdown, {
    includeFootnoteTerminatingBlank: true,
  });
}

function identityFromRange(
  range: SourceBoundaryRange,
  index: number,
): LexicalSourceBlockIdentity {
  return {
    from: range.from,
    index,
    raw: range.raw,
    to: range.to,
    variant: range.variant,
  };
}

function createIdentityMap(
  rootChildren: readonly LexicalNode[],
  markdown: string,
): Map<string, LexicalSourceBlockIdentity> | null {
  const ranges = sourceBoundariesForIdentity(markdown);
  if (ranges.length !== rootChildren.length) {
    return null;
  }

  const identities = new Map<string, LexicalSourceBlockIdentity>();
  rootChildren.forEach((node, index) => {
    const range = ranges[index];
    if (!range) {
      return;
    }
    identities.set(node.getKey(), identityFromRange(range, index));
  });
  return identities;
}

function publishIdentityMap(
  editor: LexicalEditor,
  rootChildren: readonly LexicalNode[],
  markdown: string,
): Map<string, LexicalSourceBlockIdentity> | null {
  const identities = createIdentityMap(rootChildren, markdown);
  if (identities) {
    sourceBlockIdentitiesByEditor.set(editor, identities);
  } else {
    sourceBlockIdentitiesByEditor.delete(editor);
  }
  return identities;
}

function identityMatchesRange(
  identity: LexicalSourceBlockIdentity,
  range: SourceBoundaryRangeWithIndex,
): boolean {
  return (
    identity.from === range.from
    && identity.index === range.index
    && identity.raw === range.raw
    && identity.to === range.to
    && identity.variant === range.variant
  );
}

function findNodeByIdentity(
  rootChildren: readonly LexicalNode[],
  identities: ReadonlyMap<string, LexicalSourceBlockIdentity>,
  range: SourceBoundaryRangeWithIndex,
): LexicalNode | null {
  for (const node of rootChildren) {
    const identity = identities.get(node.getKey());
    if (identity && identityMatchesRange(identity, range)) {
      return node;
    }
  }
  return null;
}

export function publishLexicalSourceBlockIdentitiesForCurrentRoot(
  editor: LexicalEditor,
  markdown: string,
): void {
  publishIdentityMap(editor, $getRoot().getChildren(), markdown);
}

export function findLexicalSourceBlockNodeByIdentity(
  editor: LexicalEditor,
  rootChildren: readonly LexicalNode[],
  markdown: string,
  range: SourceBoundaryRangeWithIndex,
): LexicalNode | null {
  const currentIdentities = sourceBlockIdentitiesByEditor.get(editor);
  const currentMatch = currentIdentities
    ? findNodeByIdentity(rootChildren, currentIdentities, range)
    : null;
  if (currentMatch) {
    return currentMatch;
  }

  const refreshedIdentities = publishIdentityMap(editor, rootChildren, markdown);
  return refreshedIdentities
    ? findNodeByIdentity(rootChildren, refreshedIdentities, range)
    : null;
}
