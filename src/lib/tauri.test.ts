import { describe, expect, it } from "vitest";
import { isTauri } from "./tauri";

describe("isTauri", () => {
  it("detects the Tauri v2 runtime without relying on the optional __TAURI__ global", () => {
    const tauriWindow = window as Window & { __TAURI_INTERNALS__?: unknown };
    const previousInternals = tauriWindow.__TAURI_INTERNALS__;
    const previousIsTauri = (globalThis as typeof globalThis & { isTauri?: boolean }).isTauri;

    try {
      delete tauriWindow.__TAURI_INTERNALS__;
      (globalThis as typeof globalThis & { isTauri?: boolean }).isTauri = true;
      expect(isTauri()).toBe(true);

      delete (globalThis as typeof globalThis & { isTauri?: boolean }).isTauri;
      tauriWindow.__TAURI_INTERNALS__ = {};
      expect(isTauri()).toBe(true);
    } finally {
      if (previousInternals === undefined) {
        delete tauriWindow.__TAURI_INTERNALS__;
      } else {
        tauriWindow.__TAURI_INTERNALS__ = previousInternals;
      }
      if (previousIsTauri === undefined) {
        delete (globalThis as typeof globalThis & { isTauri?: boolean }).isTauri;
      } else {
        (globalThis as typeof globalThis & { isTauri?: boolean }).isTauri = previousIsTauri;
      }
    }
  });
});
