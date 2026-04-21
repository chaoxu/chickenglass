export type UnsavedChangesDecision = "save" | "discard" | "cancel";

export type UnsavedChangesReason =
  | "switch-file"
  | "close-file"
  | "close-window"
  | "switch-project"
  | "delete-file"
  | "delete-folder";

export interface UnsavedChangesRequest {
  reason: UnsavedChangesReason;
  currentDocument: {
    path: string;
    name: string;
  };
  target?: {
    path?: string;
    name: string;
  };
}
