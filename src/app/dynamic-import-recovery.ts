import { logCatchError } from "./lib/log-catch-error";

const DYNAMIC_IMPORT_RECOVERY_KEY = "coflat.dynamic-import-recovery";

const DYNAMIC_IMPORT_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
];

function matchesDynamicImportFailure(message: string): boolean {
  return DYNAMIC_IMPORT_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function extractDynamicImportMessage(value: unknown): string | null {
  if (value instanceof Error) return value.message || null;
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null) return null;

  const candidate = value as { readonly message?: unknown; readonly reason?: unknown };
  if (typeof candidate.message === "string") return candidate.message;
  if (candidate.reason instanceof Error) return candidate.reason.message || null;
  if (typeof candidate.reason === "string") return candidate.reason;
  return null;
}

export function isDynamicImportFailure(value: unknown): boolean {
  const message = extractDynamicImportMessage(value);
  return message !== null && matchesDynamicImportFailure(message);
}

export function clearDynamicImportRecoveryFlag(
  storage: Pick<Storage, "removeItem"> = window.sessionStorage,
): void {
  storage.removeItem(DYNAMIC_IMPORT_RECOVERY_KEY);
}

interface DynamicImportRecoveryOptions {
  readonly reload?: () => void;
  readonly storage?: Pick<Storage, "getItem" | "setItem">;
  readonly target?: Pick<Window, "addEventListener" | "removeEventListener">;
}

export function installDynamicImportRecovery({
  reload = () => window.location.reload(),
  storage = window.sessionStorage,
  target = window,
}: DynamicImportRecoveryOptions = {}): () => void {
  const triggerReload = (): void => {
    if (storage.getItem(DYNAMIC_IMPORT_RECOVERY_KEY) === "1") return;
    storage.setItem(DYNAMIC_IMPORT_RECOVERY_KEY, "1");
    reload();
  };

  const handleError = (event: Event): void => {
    try {
      if (!isDynamicImportFailure(event)) return;
      event.preventDefault();
      triggerReload();
    } catch (err) {
      logCatchError("[dynamic-import-recovery] error handler failed")(err);
    }
  };

  const handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
    try {
      if (!isDynamicImportFailure(event.reason)) return;
      event.preventDefault();
      triggerReload();
    } catch (err) {
      logCatchError("[dynamic-import-recovery] rejection handler failed")(err);
    }
  };

  target.addEventListener("error", handleError);
  target.addEventListener("unhandledrejection", handleUnhandledRejection);

  return () => {
    target.removeEventListener("error", handleError);
    target.removeEventListener("unhandledrejection", handleUnhandledRejection);
  };
}
