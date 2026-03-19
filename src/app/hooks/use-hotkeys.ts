/**
 * useHotkeys — React hook for registering global keyboard shortcuts.
 *
 * Attaches a single keydown listener to `document` that dispatches to the
 * matching binding.  Modifier keys follow platform convention: Cmd on macOS,
 * Ctrl elsewhere.
 *
 * Bindings are re-registered whenever the `bindings` reference changes, so
 * callers should stabilise the array with useMemo/useCallback or define it
 * outside the component if it's static.
 */

import { useEffect, useRef } from "react";

/** Whether we're on macOS — computed once, never changes at runtime. */
const isMac = typeof navigator !== "undefined" &&
  navigator.platform.toLowerCase().startsWith("mac");

/** A single key binding. */
export interface HotkeyBinding {
  /**
   * Key combination string.  Modifiers are separated by "+".
   * Use "mod" for Cmd on macOS / Ctrl elsewhere.
   * Examples: "mod+s", "mod+shift+p", "Escape", "F1"
   */
  key: string;
  /** Handler called when the combination fires. */
  handler: (e: KeyboardEvent) => void;
  /**
   * When true the handler is called even if the active element is an input,
   * textarea, or contenteditable.  Defaults to false.
   */
  allowInInputs?: boolean;
}

// ── Normalise a binding key string into a comparable set of flags ──────────

interface ParsedKey {
  mod: boolean;   // Cmd (macOS) / Ctrl (others)
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  key: string;    // Normalised key name (lower-case)
}

function parseKey(combo: string): ParsedKey {
  const parts = combo.split("+");
  const key = parts[parts.length - 1] ?? "";
  const mods = new Set(parts.slice(0, -1).map((p) => p.toLowerCase()));

  return {
    mod:   mods.has("mod"),
    ctrl:  mods.has("ctrl"),
    alt:   mods.has("alt"),
    shift: mods.has("shift"),
    meta:  mods.has("meta"),
    key,
  };
}

function matchesEvent(parsed: ParsedKey, e: KeyboardEvent): boolean {
  const modPressed = isMac ? e.metaKey : e.ctrlKey;

  // Each declared modifier must be held.
  if (parsed.mod   && !modPressed) return false;
  if (parsed.ctrl  && !e.ctrlKey)  return false;
  if (parsed.alt   && !e.altKey)   return false;
  if (parsed.shift && !e.shiftKey) return false;
  if (parsed.meta  && !e.metaKey)  return false;

  // Each held modifier must be declared (prevents "s" matching "mod+s").
  if (!parsed.mod   && modPressed)  return false;
  if (!parsed.ctrl  && e.ctrlKey && !(isMac && parsed.mod)) return false;
  if (!parsed.alt   && e.altKey)    return false;
  if (!parsed.shift && e.shiftKey)  return false;

  // Key comparison is case-insensitive.
  return e.key.toLowerCase() === parsed.key.toLowerCase();
}

/** Pre-parsed binding ready for fast matching on each keydown. */
interface PreparedBinding {
  parsed: ParsedKey;
  handler: (e: KeyboardEvent) => void;
  allowInInputs: boolean;
}

function prepareBindings(bindings: HotkeyBinding[]): PreparedBinding[] {
  return bindings.map((b) => ({
    parsed: parseKey(b.key),
    handler: b.handler,
    allowInInputs: b.allowInInputs ?? false,
  }));
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useHotkeys(bindings: HotkeyBinding[]): void {
  // Pre-parse bindings once per bindings change, not on every keydown.
  const preparedRef = useRef<PreparedBinding[]>([]);
  useEffect(() => {
    preparedRef.current = prepareBindings(bindings);
  }, [bindings]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;

      for (const binding of preparedRef.current) {
        if (inInput && !binding.allowInInputs) continue;
        if (matchesEvent(binding.parsed, e)) {
          binding.handler(e);
          // Don't break — allow multiple bindings for the same key if needed.
        }
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []); // Intentionally empty — preparedRef keeps the latest bindings.
}
