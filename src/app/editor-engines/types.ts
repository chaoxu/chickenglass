import type { ComponentType } from "react";

import type { CoflatEditorEngine } from "../../product";
import type { ActiveDocumentSignal } from "../active-document-signal";
import type { DiagnosticEntry } from "../diagnostics";
import type { FileSystem } from "../file-manager";
import type { HeadingEntry } from "../heading-ancestry";
import type { EditorDocumentChange } from "../../lib/editor-doc-change";

export interface EditorSelectionSnapshot {
  readonly anchor: number;
  readonly focus: number;
  readonly from: number;
  readonly to: number;
}

export interface EditorSurfaceCommonProps<
  TMode extends string,
  TReadyPayload = unknown,
> {
  readonly doc: string;
  readonly docPath?: string;
  readonly editorMode?: TMode;
  readonly fs?: FileSystem;
  readonly activeDocumentSignal?: ActiveDocumentSignal;
  readonly onDocChange?: (changes: readonly EditorDocumentChange[]) => void;
  readonly onProgrammaticDocChange?: (doc: string) => void;
  readonly onDocumentReady?: (payload: TReadyPayload) => void;
  readonly onHeadingsChange?: (headings: HeadingEntry[]) => void;
  readonly onDiagnosticsChange?: (diagnostics: DiagnosticEntry[]) => void;
  readonly onSelectionChange?: (selection: EditorSelectionSnapshot) => void;
}

export interface EditorEngineDescriptor<
  TMode extends string,
  TSurfaceProps extends EditorSurfaceCommonProps<TMode, unknown>,
> {
  readonly id: CoflatEditorEngine;
  readonly productId: "coflat" | "coflat2";
  readonly displayName: string;
  readonly defaultMode: TMode;
  readonly Surface: ComponentType<TSurfaceProps>;
}

export interface EditorEngineReadiness {
  readonly id: CoflatEditorEngine;
  readonly integrated: boolean;
  readonly sourceOwner: "coflat" | "coflat2";
  readonly notes: string;
}
