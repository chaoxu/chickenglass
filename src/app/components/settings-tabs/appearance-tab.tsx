import type { Settings, Theme } from "../../lib/types";
import { cn } from "../../lib/utils";
import { builtinThemes } from "../../themes";
import { themePresets, themePresetKeys } from "../../../editor/theme-config";
import { Textarea } from "../ui/textarea";
import { Row } from "./shared";

// ── Constants ─────────────────────────────────────────────────────────────────

const THEME_OPTIONS: Array<{ value: Theme; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

// ── Component ─────────────────────────────────────────────────────────────────

interface AppearanceTabProps {
  theme: Theme;
  onSetTheme: (theme: Theme) => void;
  settings: Settings;
  onUpdateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

export function AppearanceTab({ theme, onSetTheme, settings, onUpdateSetting }: AppearanceTabProps) {
  return (
    <section>
      {/* Light / Dark / System toggle */}
      <Row label="Mode">
        <div className="flex gap-2">
          {THEME_OPTIONS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => { onSetTheme(t.value); }}
              className={cn(
                "px-3 py-1 text-sm rounded border transition-colors duration-[var(--cf-transition,0.15s)]",
                theme === t.value
                  ? "bg-[var(--cf-accent)] text-[var(--cf-accent-fg)] border-[var(--cf-accent)]"
                  : "border-[var(--cf-border)] text-[var(--cf-fg)] hover:bg-[var(--cf-hover)]",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </Row>

      {/* Writing preset (typography: fonts, heading sizes) */}
      <div className="py-3 border-b border-[var(--cf-border)]">
        <label className="text-sm text-[var(--cf-fg)] block mb-2">Writing preset</label>
        <p className="text-xs text-[var(--cf-muted)] mb-2">
          UI, prose, and code fonts plus heading sizes and line spacing.
        </p>
        <div className="grid grid-cols-3 gap-2">
          {themePresetKeys.map((key) => {
            const preset = themePresets[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => { onUpdateSetting("writingTheme", key); }}
                className={cn(
                  "px-3 py-2 text-sm rounded border text-left transition-colors duration-[var(--cf-transition,0.15s)]",
                  settings.writingTheme === key
                    ? "bg-[var(--cf-accent)] text-[var(--cf-accent-fg)] border-[var(--cf-accent)]"
                    : "border-[var(--cf-border)] text-[var(--cf-fg)] hover:bg-[var(--cf-hover)]",
                )}
              >
                <span className="font-medium">{preset.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Writing theme selection */}
      <div className="py-3 border-b border-[var(--cf-border)]">
        <label className="text-sm text-[var(--cf-fg)] block mb-2">Color theme</label>
        <div className="grid grid-cols-2 gap-2">
          {builtinThemes.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => { onUpdateSetting("themeName", t.id); }}
              className={cn(
                "px-3 py-2 text-sm rounded border text-left transition-colors duration-[var(--cf-transition,0.15s)]",
                settings.themeName === t.id
                  ? "bg-[var(--cf-accent)] text-[var(--cf-accent-fg)] border-[var(--cf-accent)]"
                  : "border-[var(--cf-border)] text-[var(--cf-fg)] hover:bg-[var(--cf-hover)]",
              )}
            >
              <span className="font-medium">{t.name}</span>
              {t.dark && (
                <span className="ml-1 text-xs opacity-60">(dark)</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Custom CSS */}
      <div className="py-3">
        <label htmlFor="sd-custom-css" className="text-sm text-[var(--cf-fg)] block mb-1">
          Custom CSS
        </label>
        <p className="text-xs text-[var(--cf-muted)] mb-2">
          Add your own CSS overrides. Changes apply immediately.
        </p>
        <Textarea
          id="sd-custom-css"
          value={settings.customCss}
          onChange={(e) => { onUpdateSetting("customCss", e.target.value); }}
          placeholder={`/* Example: change editor font */\n.cm-content {\n  font-family: "Georgia", serif;\n}`}
          className="h-32 resize-y text-xs font-mono"
          spellCheck={false}
        />
      </div>
    </section>
  );
}
