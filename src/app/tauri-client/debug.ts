import { tauriCommand, tauriArgs } from "./make-command";

export interface NativeWindowDebugInfo {
  label: string;
  focused: boolean;
}

export interface NativeDebugState {
  project_root: string | null;
  project_generation: number | null;
  watcher_root: string | null;
  watcher_generation: number | null;
  watcher_active: boolean;
  last_focused_window: string | null;
}

export const debugListWindowsCommand = tauriCommand<NativeWindowDebugInfo[]>("debug_list_windows");
export const debugGetNativeStateCommand = tauriCommand<NativeDebugState>("debug_get_native_state");
export const debugEmitFileChangedCommand = tauriArgs<undefined>("debug_emit_file_changed")((relativePath: string) => ({ relativePath }));
