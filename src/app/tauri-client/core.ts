import { invoke } from "@tauri-apps/api/core";

export const NATIVE_COMMAND_ERROR_CODES = [
  "export.pandocFailed",
  "export.pandocUnavailable",
  "export.unsupportedFormat",
  "fs.alreadyExists",
  "fs.notFound",
  "native.error",
  "native.io",
  "path.escape",
  "path.notDirectory",
  "path.resolve",
  "project.noProject",
] as const;

export type NativeCommandErrorCode = typeof NATIVE_COMMAND_ERROR_CODES[number];

const NATIVE_COMMAND_ERROR_CODE_SET = new Set<string>(NATIVE_COMMAND_ERROR_CODES);

export interface NativeCommandError {
  readonly code: NativeCommandErrorCode;
  readonly message: string;
  readonly details?: string;
}

export function isNativeCommandError(error: unknown): error is NativeCommandError {
  if (!error || typeof error !== "object") return false;
  const candidate = error as Partial<Record<keyof NativeCommandError, unknown>>;
  return (
    typeof candidate.code === "string"
    && NATIVE_COMMAND_ERROR_CODE_SET.has(candidate.code)
    && typeof candidate.message === "string"
  );
}

export async function invokeTauriCommandRaw<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return invoke<T>(command, args);
}
