import { useState } from "react";
import type { ReactNode } from "react";
import type { Settings, ExportFormat } from "../lib/types";
import type { Theme } from "../theme-manager";
import { cn } from "../lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type SettingsTab = "General" | "Editor" | "Appearance" | "Plugins" | "Export";

/** Minimal plugin info needed by the settings UI. */
export interface PluginInfo {
  plugin: {
    id: string;
    name: string;
    description?: string;
    defaultEnabled: boolean;
  };
  enabled: boolean;
}

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
  onUpdateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  theme: Theme;
  onSetTheme: (theme: Theme) => void;
  plugins?: PluginInfo[];
}

// ── Shared constants ──────────────────────────────────────────────────────────

const SELECT_CLASS =
  "text-sm border border-[var(--cg-border)] rounded px-2 py-1 bg-[var(--cg-bg)] text-[var(--cg-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--cg-accent)]";

const TABS: SettingsTab[] = ["General", "Editor", "Appearance", "Plugins", "Export"];

const THEME_OPTIONS: Array<{ value: Theme; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

// ── Shared field components ───────────────────────────────────────────────────

interface RowProps {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}

function Row({ label, htmlFor, children }: RowProps) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-[var(--cg-border)] last:border-b-0">
      <label
        htmlFor={htmlFor}
        className="text-sm text-[var(--cg-fg)] cursor-pointer select-none"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

// ── Tab panels ────────────────────────────────────────────────────────────────

interface GeneralTabProps {
  settings: Settings;
  onUpdateSetting: SettingsDialogProps["onUpdateSetting"];
}

function GeneralTab({ settings, onUpdateSetting }: GeneralTabProps) {
  const intervalValue =
    settings.autoSaveInterval === 0
      ? "off"
      : String(Math.round(settings.autoSaveInterval / 1000));

  function handleIntervalChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value;
    onUpdateSetting("autoSaveInterval", v === "off" ? 0 : Number(v) * 1000);
  }

  return (
    <section>
      <Row label="Auto-save interval" htmlFor="sd-autosave-interval">
        <select
          id="sd-autosave-interval"
          value={intervalValue}
          onChange={handleIntervalChange}
          className={SELECT_CLASS}
        >
          <option value="off">Off</option>
          <option value="30">30 seconds</option>
          <option value="60">1 minute</option>
          <option value="120">2 minutes</option>
          <option value="300">5 minutes</option>
        </select>
      </Row>
    </section>
  );
}

interface EditorTabProps {
  settings: Settings;
  onUpdateSetting: SettingsDialogProps["onUpdateSetting"];
}

function EditorTab({ settings, onUpdateSetting }: EditorTabProps) {
  return (
    <section>
      {/* Font size */}
      <Row label={`Font size: ${settings.fontSize}px`} htmlFor="sd-font-size">
        <input
          id="sd-font-size"
          type="range"
          min={10}
          max={28}
          step={1}
          value={settings.fontSize}
          onChange={(e) => { onUpdateSetting("fontSize", Number(e.target.value)); }}
          className="w-32 accent-[var(--cg-accent)]"
        />
      </Row>

      {/* Line height */}
      <Row
        label={`Line height: ${settings.lineHeight.toFixed(1)}`}
        htmlFor="sd-line-height"
      >
        <input
          id="sd-line-height"
          type="range"
          min={1.2}
          max={2.0}
          step={0.1}
          value={settings.lineHeight}
          onChange={(e) => { onUpdateSetting("lineHeight", Number(e.target.value)); }}
          className="w-32 accent-[var(--cg-accent)]"
        />
      </Row>

      {/* Tab size */}
      <Row label="Tab size" htmlFor="sd-tab-size">
        <select
          id="sd-tab-size"
          value={settings.tabSize}
          onChange={(e) => { onUpdateSetting("tabSize", Number(e.target.value)); }}
          className={SELECT_CLASS}
        >
          <option value={2}>2 spaces</option>
          <option value={4}>4 spaces</option>
        </select>
      </Row>

      {/* Show line numbers */}
      <Row label="Show line numbers" htmlFor="sd-line-numbers">
        <input
          id="sd-line-numbers"
          type="checkbox"
          checked={settings.showLineNumbers}
          onChange={(e) => { onUpdateSetting("showLineNumbers", e.target.checked); }}
          className="w-4 h-4 accent-[var(--cg-accent)]"
        />
      </Row>

      {/* Word wrap */}
      <Row label="Word wrap" htmlFor="sd-word-wrap">
        <input
          id="sd-word-wrap"
          type="checkbox"
          checked={settings.wordWrap}
          onChange={(e) => { onUpdateSetting("wordWrap", e.target.checked); }}
          className="w-4 h-4 accent-[var(--cg-accent)]"
        />
      </Row>

    </section>
  );
}

interface AppearanceTabProps {
  theme: Theme;
  onSetTheme: (theme: Theme) => void;
}

function AppearanceTab({ theme, onSetTheme }: AppearanceTabProps) {
  return (
    <section>
      <Row label="Theme">
        <div className="flex gap-2">
          {THEME_OPTIONS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => { onSetTheme(t.value); }}
              className={cn(
                "px-3 py-1 text-sm rounded border transition-colors duration-[var(--cg-transition,0.15s)]",
                theme === t.value
                  ? "bg-[var(--cg-accent)] text-[var(--cg-accent-fg)] border-[var(--cg-accent)]"
                  : "border-[var(--cg-border)] text-[var(--cg-fg)] hover:bg-[var(--cg-hover)]",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </Row>
    </section>
  );
}

interface ExportTabProps {
  settings: Settings;
  onUpdateSetting: SettingsDialogProps["onUpdateSetting"];
}

function ExportTab({ settings, onUpdateSetting }: ExportTabProps) {
  return (
    <section>
      <Row label="Default format" htmlFor="sd-export-format">
        <select
          id="sd-export-format"
          value={settings.defaultExportFormat}
          onChange={(e) => {
            onUpdateSetting("defaultExportFormat", e.target.value as ExportFormat);
          }}
          className={SELECT_CLASS}
        >
          <option value="pdf">PDF</option>
          <option value="latex">LaTeX</option>
          <option value="html">HTML</option>
        </select>
      </Row>
    </section>
  );
}

interface PluginsTabProps {
  settings: Settings;
  onUpdateSetting: SettingsDialogProps["onUpdateSetting"];
  plugins: PluginInfo[];
}

function PluginsTab({ settings, onUpdateSetting, plugins }: PluginsTabProps) {
  if (plugins.length === 0) {
    return (
      <section>
        <p className="text-sm text-[var(--cg-muted)]">No plugins registered.</p>
      </section>
    );
  }

  return (
    <section>
      {plugins.map(({ plugin }) => {
        const isEnabled = settings.enabledPlugins[plugin.id] ?? plugin.defaultEnabled;
        return (
          <div
            key={plugin.id}
            className="flex items-center justify-between py-2 border-b border-[var(--cg-border)] last:border-b-0"
          >
            <div className="flex flex-col">
              <span className="text-sm font-medium text-[var(--cg-fg)]">{plugin.name}</span>
              {plugin.description && (
                <span className="text-xs text-[var(--cg-muted)]">{plugin.description}</span>
              )}
            </div>
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={() => {
                onUpdateSetting("enabledPlugins", {
                  ...settings.enabledPlugins,
                  [plugin.id]: !isEnabled,
                });
              }}
              className="w-4 h-4 accent-[var(--cg-accent)] shrink-0 ml-4"
            />
          </div>
        );
      })}
    </section>
  );
}

// ── Main dialog ───────────────────────────────────────────────────────────────

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onUpdateSetting,
  theme,
  onSetTheme,
  plugins = [],
}: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("General");

  if (!open) return null;

  function handleOverlayMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onOpenChange(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onOpenChange(false);
    }
  }

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={handleOverlayMouseDown}
      onKeyDown={handleKeyDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="flex flex-col w-[560px] max-h-[80vh] rounded-lg bg-[var(--cg-bg)] border border-[var(--cg-border)] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--cg-border)] shrink-0">
          <h2 className="text-base font-semibold text-[var(--cg-fg)]">Settings</h2>
          <button
            type="button"
            aria-label="Close settings"
            onClick={() => { onOpenChange(false); }}
            className="text-[var(--cg-muted)] hover:text-[var(--cg-fg)] text-lg leading-none"
          >
            ×
          </button>
        </div>

        {/* Body: nav + content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Nav */}
          <nav className="flex flex-col w-36 shrink-0 border-r border-[var(--cg-border)] py-2 bg-[var(--cg-subtle)]">
            {TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => { setActiveTab(tab); }}
                className={cn(
                  "text-left px-4 py-2 text-sm transition-colors",
                  activeTab === tab
                    ? "bg-[var(--cg-bg)] text-[var(--cg-fg)] font-medium"
                    : "text-[var(--cg-muted)] hover:text-[var(--cg-fg)] hover:bg-[var(--cg-bg)]",
                )}
              >
                {tab}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {activeTab === "General" && (
              <GeneralTab settings={settings} onUpdateSetting={onUpdateSetting} />
            )}
            {activeTab === "Editor" && (
              <EditorTab settings={settings} onUpdateSetting={onUpdateSetting} />
            )}
            {activeTab === "Appearance" && (
              <AppearanceTab theme={theme} onSetTheme={onSetTheme} />
            )}
            {activeTab === "Plugins" && (
              <PluginsTab settings={settings} onUpdateSetting={onUpdateSetting} plugins={plugins} />
            )}
            {activeTab === "Export" && (
              <ExportTab settings={settings} onUpdateSetting={onUpdateSetting} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
