export type SidebarTab = "files" | "outline" | "diagnostics" | "runtime";

export interface ScrollGuardEvent {
  readonly timestamp: number;
  readonly wheelDeltaY: number;
  readonly previousTop: number;
  readonly correctedTop: number;
  readonly observedTop: number;
  readonly previousHeight: number;
  readonly currentHeight: number;
  readonly paddingBottom: number;
  readonly preservedMaxScrollTop: number;
  readonly observedMaxScrollTop: number;
}

export interface MarkdownEditorSelection {
  readonly anchor: number;
  readonly focus: number;
  readonly from: number;
  readonly to: number;
}

export interface InteractionTraceEntry {
  readonly ts: number;
  readonly type: "click" | "input" | "scroll-jump";
  readonly nodeType: string | null;
  readonly nodeKey: string | null;
  readonly target: string;
  readonly clientX?: number;
  readonly clientY?: number;
  readonly editorX?: number | null;
  readonly editorY?: number | null;
  readonly scrollBefore: number;
  readonly scrollAfter: number;
  readonly handled: boolean;
  readonly inputType?: string;
  readonly data?: string | null;
}

export type NativeWatcherHealth =
  | "starting"
  | "healthy"
  | "degraded"
  | "failed";

export interface WatcherHealthEvent {
  readonly status: NativeWatcherHealth;
  readonly generation: number;
  readonly root: string;
  readonly message: string;
  readonly error?: string;
}

export type FileWatcherHealth = NativeWatcherHealth | "stopped";

export interface FileWatcherStatus {
  status: FileWatcherHealth;
  generation: number | null;
  root: string | null;
  message: string;
  error?: string;
  updatedAt: number;
}

export interface VisibleRawFencedOpener {
  readonly line: number | null;
  readonly text: string;
  readonly classes: string[];
}

export interface DebugRenderState {
  readonly renderedBlockHeaders: number;
  readonly inlineMath: number;
  readonly displayMath: number;
  readonly citations: number;
  readonly crossrefs: number;
  readonly tables: number;
  readonly figures: number;
  readonly visibleRawFencedOpeners: readonly VisibleRawFencedOpener[];
}

export interface SelectionInfo {
  readonly anchor: number;
  readonly head: number;
  readonly from: number;
  readonly to: number;
  readonly empty: boolean;
  readonly line: number;
  readonly col: number;
}

export interface DebugDocumentState {
  path: string;
  name: string;
  dirty: boolean;
}

export interface FencedStructureEditTarget {
  readonly kind: "fenced-opener";
  readonly openFenceFrom: number;
  readonly editFrom: number;
  readonly editTo: number;
  readonly revealFrom: number;
  readonly revealTo: number;
  readonly className: string;
  readonly title: string | null;
}

export interface FrontmatterStructureEditTarget {
  readonly kind: "frontmatter";
  readonly from: 0;
  readonly to: number;
  readonly title: string | null;
}

export interface CodeFenceStructureEditTarget {
  readonly kind: "code-fence";
  readonly from: number;
  readonly to: number;
  readonly openFenceFrom: number;
  readonly openFenceTo: number;
  readonly closeFenceFrom: number;
  readonly closeFenceTo: number;
  readonly marker: string;
  readonly language: string;
}

export interface FootnoteLabelStructureEditTarget {
  readonly kind: "footnote-label";
  readonly id: string;
  readonly from: number;
  readonly to: number;
  readonly labelFrom: number;
  readonly labelTo: number;
}

export interface DisplayMathStructureEditTarget {
  readonly kind: "display-math";
  readonly from: number;
  readonly to: number;
  readonly contentFrom: number;
  readonly contentTo: number;
}

export type StructureEditTarget =
  | FencedStructureEditTarget
  | FrontmatterStructureEditTarget
  | CodeFenceStructureEditTarget
  | FootnoteLabelStructureEditTarget
  | DisplayMathStructureEditTarget;
