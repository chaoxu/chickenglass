import { invokeWithPerf } from "../perf";

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

export function debugListWindowsCommand(): Promise<NativeWindowDebugInfo[]> {
  return invokeWithPerf<NativeWindowDebugInfo[]>("debug_list_windows");
}

export function debugGetNativeStateCommand(): Promise<NativeDebugState> {
  return invokeWithPerf<NativeDebugState>("debug_get_native_state");
}

export function debugEmitFileChangedCommand(relativePath: string): Promise<void> {
  return invokeWithPerf("debug_emit_file_changed", { relativePath });
}
