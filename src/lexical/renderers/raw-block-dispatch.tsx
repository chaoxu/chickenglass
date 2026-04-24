import { memo, useMemo, type ComponentType, type JSX } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { NodeKey } from "lexical";

import { FigureMedia } from "../figure-media";
import { parseMarkdownImage } from "../markdown/image-markdown";
import type { RawBlockVariant } from "../nodes/raw-block-node";
import { StructureSourceEditor } from "../structure-source-editor";
import { useStructureEditToggle } from "../structure-edit-plugin";
import { useStructureSourceSelectionBridge } from "../structure-source-selection";
import { useLexicalSurfaceEditable } from "../editability-context";
import { FencedDivBlockRenderer } from "./fenced-div-renderers";
import { FootnoteDefinitionBlockRenderer } from "./footnote-renderers";
import { FrontmatterRenderer } from "./frontmatter-renderer";
import { DisplayMathBlockRenderer } from "./math-renderers";
import { RawBlockSourceRangeShell } from "./raw-block-source-range";
import { structureToggleProps, useRawBlockUpdater } from "./shared";

interface RawBlockContentRendererProps {
  readonly nodeKey: NodeKey;
  readonly raw: string;
}

function ImageBlockRenderer({
  nodeKey,
  raw,
}: {
  readonly nodeKey: NodeKey;
  readonly raw: string;
}) {
  const [editor] = useLexicalComposerContext();
  const surfaceEditable = useLexicalSurfaceEditable();
  const updateRaw = useRawBlockUpdater(nodeKey);
  const sourceEdit = useStructureEditToggle(nodeKey, "image", "image-source");
  const onSelectionChange = useStructureSourceSelectionBridge(editor, nodeKey, 0);
  const parsed = useMemo(() => parseMarkdownImage(raw), [raw]);
  if (!parsed) {
    return <div className="cf-lexical-raw-fallback">{raw}</div>;
  }

  if (sourceEdit.active) {
    return (
      <div className="cf-lexical-block-source-line">
        <StructureSourceEditor
          className="cf-lexical-editor cf-lexical-nested-editor cf-lexical-structure-source-editor cf-lexical-structure-source-editor--image"
          doc={raw}
          namespace={`coflat-image-source-${nodeKey}`}
          onChange={(nextRaw) => updateRaw(() => nextRaw)}
          onClose={sourceEdit.deactivate}
          onSelectionChange={onSelectionChange}
        />
      </div>
    );
  }

  return (
    <FigureMedia
      activationProps={structureToggleProps(surfaceEditable, sourceEdit.activate, {
        keyboardActivation: true,
      })}
      alt={parsed.alt}
      src={parsed.src}
    />
  );
}

function RawFallbackRenderer({ raw }: RawBlockContentRendererProps): JSX.Element {
  return <div className="cf-lexical-raw-fallback">{raw}</div>;
}

const RAW_BLOCK_CONTENT_RENDERERS = {
  "display-math": DisplayMathBlockRenderer,
  "fenced-div": FencedDivBlockRenderer,
  "footnote-definition": FootnoteDefinitionBlockRenderer,
  frontmatter: FrontmatterRenderer,
  "grid-table": RawFallbackRenderer,
  image: ImageBlockRenderer,
} satisfies Record<RawBlockVariant, ComponentType<RawBlockContentRendererProps>>;

// Lexical recreates the decorator React element on every reconciliation pass
// with primitive props (`nodeKey`, `raw`, `variant`). Memoizing skips the
// dispatch logic AND the inner variant component re-render whenever those
// props are unchanged — a major win on docs with hundreds of blocks where a
// single edit otherwise re-renders every decorator.
export const RawBlockRenderer = memo(function RawBlockRenderer({
  nodeKey,
  raw,
  variant,
}: {
  readonly nodeKey: NodeKey;
  readonly raw: string;
  readonly variant: RawBlockVariant;
}) {
  const ContentRenderer = RAW_BLOCK_CONTENT_RENDERERS[variant] ?? RawFallbackRenderer;

  return (
    <RawBlockSourceRangeShell
      className={`cf-lexical-raw-block-shell cf-lexical-raw-block-shell--${variant}`}
      nodeKey={nodeKey}
      variant={variant}
    >
      <ContentRenderer nodeKey={nodeKey} raw={raw} />
    </RawBlockSourceRangeShell>
  );
});
