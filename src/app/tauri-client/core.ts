import { invoke } from "@tauri-apps/api/core";

export interface NativeCommandError {
  readonly code: string;
  readonly message: string;
  readonly details?: string;
}

export function isNativeCommandError(error: unknown): error is NativeCommandError {
  if (!error || typeof error !== "object") return false;
  const candidate = error as Partial<Record<keyof NativeCommandError, unknown>>;
  return typeof candidate.code === "string" && typeof candidate.message === "string";
}

export async function invokeTauriCommandRaw<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return invoke<T>(command, args);
}
