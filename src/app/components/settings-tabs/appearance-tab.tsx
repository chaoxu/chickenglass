import type { Settings, Theme } from "../../lib/types";
import { cn } from "../../lib/utils";
import { builtinThemes } from "../../themes";
import { themePresets, themePresetKeys } from "../../theme-config";
import { Textarea } from "../ui/textarea";
import { Field, Section } from "./shared";

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
    <>
      <Section title="Theme">
        <Field label="Mode">
          <div
            role="radiogroup"
            aria-label="Color mode"
            className="inline-flex rounded-md border border-[var(--cf-border)] p-0.5"
          >
            {THEME_OPTIONS.map((t) => {
              const active = theme === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => { onSetTheme(t.value); }}
                  className={cn(
                    "px-3 py-1 text-xs rounded transition-colors duration-[var(--cf-transition)]",
                    active
                      ? "bg-[var(--cf-accent)] text-[var(--cf-accent-fg)] shadow-sm"
                      : "text-[var(--cf-fg)] hover:bg-[var(--cf-hover)]",
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </Field>
      </Section>

      <Section
        title="Writing preset"
        description="UI, prose, and code fonts plus heading sizes and line spacing."
      >
        <div className="grid grid-cols-3 gap-2 pt-1">
          {themePresetKeys.map((key) => {
            const preset = themePresets[key];
            const active = settings.writingTheme === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => { onUpdateSetting("writingTheme", key); }}
                className={cn(
                  "px-3 py-2.5 text-sm rounded-md border text-left transition-colors duration-[var(--cf-transition)]",
                  active
                    ? "bg-[var(--cf-accent)] text-[var(--cf-accent-fg)] border-[var(--cf-accent)] shadow-sm"
                    : "border-[var(--cf-border)] text-[var(--cf-fg)] hover:bg-[var(--cf-hover)]",
                )}
              >
                <span className="font-medium">{preset.name}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Color theme">
        <div className="grid grid-cols-2 gap-2 pt-1">
          {builtinThemes.map((t) => {
            const active = settings.themeName === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => { onUpdateSetting("themeName", t.id); }}
                className={cn(
                  "flex items-center justify-between px-3 py-2.5 text-sm rounded-md border text-left transition-colors duration-[var(--cf-transition)]",
                  active
                    ? "bg-[var(--cf-accent)] text-[var(--cf-accent-fg)] border-[var(--cf-accent)] shadow-sm"
                    : "border-[var(--cf-border)] text-[var(--cf-fg)] hover:bg-[var(--cf-hover)]",
                )}
              >
                <span className="font-medium">{t.name}</span>
                {t.dark && <span className="text-xs opacity-60">dark</span>}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Custom CSS" description="Overrides applied immediately to the editor surface.">
        <Field label="Stylesheet" htmlFor="sd-custom-css" stacked>
          <Textarea
            id="sd-custom-css"
            value={settings.customCss}
            onChange={(e) => { onUpdateSetting("customCss", e.target.value); }}
            placeholder={`/* Example: change editor font */\n[data-testid="lexical-editor"] {\n  font-family: "Georgia", serif;\n}`}
            className="h-32 resize-y text-xs font-mono"
            spellCheck={false}
          />
        </Field>
      </Section>
    </>
  );
}
