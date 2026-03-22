import { useState } from "react";
import type { ReactNode } from "react";
import type { Settings, ExportFormat } from "../lib/types";
import type { Theme } from "../theme-manager";
import { cn } from "../lib/utils";
import { builtinThemes } from "../themes";
import { themePresets, themePresetKeys } from "../../editor/theme-config";
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Checkbox } from "./ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Slider } from "./ui/slider";
import { Textarea } from "./ui/textarea";
import { ScrollArea } from "./ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

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
    <div className="flex items-center justify-between py-2 border-b border-[var(--cf-border)] last:border-b-0">
      <label
        htmlFor={htmlFor}
        className="text-sm text-[var(--cf-fg)] cursor-pointer select-none"
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

  function handleIntervalChange(v: string) {
    onUpdateSetting("autoSaveInterval", v === "off" ? 0 : Number(v) * 1000);
  }

  return (
    <section>
      <Row label="Auto-save interval">
        <Select
          value={intervalValue}
          onValueChange={handleIntervalChange}
        >
          <SelectTrigger className="w-40" aria-label="Auto-save interval">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="off">Off</SelectItem>
            <SelectItem value="30">30 seconds</SelectItem>
            <SelectItem value="60">1 minute</SelectItem>
            <SelectItem value="120">2 minutes</SelectItem>
            <SelectItem value="300">5 minutes</SelectItem>
          </SelectContent>
        </Select>
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
      <Row label={`Font size: ${settings.fontSize}px`}>
        <Slider
          aria-label="Font size"
          min={10}
          max={28}
          step={1}
          value={[settings.fontSize]}
          onValueChange={([value]) => { onUpdateSetting("fontSize", value); }}
          className="w-32"
        />
      </Row>

      {/* Line height */}
      <Row label={`Line height: ${settings.lineHeight.toFixed(1)}`}>
        <Slider
          aria-label="Line height"
          min={1.2}
          max={2.0}
          step={0.1}
          value={[settings.lineHeight]}
          onValueChange={([value]) => { onUpdateSetting("lineHeight", value); }}
          className="w-32"
        />
      </Row>

      {/* Tab size */}
      <Row label="Tab size">
        <Select
          value={String(settings.tabSize)}
          onValueChange={(value) => { onUpdateSetting("tabSize", Number(value)); }}
        >
          <SelectTrigger className="w-32" aria-label="Tab size">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="2">2 spaces</SelectItem>
            <SelectItem value="4">4 spaces</SelectItem>
          </SelectContent>
        </Select>
      </Row>

      {/* Show line numbers */}
      <Row label="Show line numbers" htmlFor="sd-line-numbers">
        <Checkbox
          id="sd-line-numbers"
          checked={settings.showLineNumbers}
          onCheckedChange={(checked) => { onUpdateSetting("showLineNumbers", checked === true); }}
        />
      </Row>

      {/* Word wrap */}
      <Row label="Word wrap" htmlFor="sd-word-wrap">
        <Checkbox
          id="sd-word-wrap"
          checked={settings.wordWrap}
          onCheckedChange={(checked) => { onUpdateSetting("wordWrap", checked === true); }}
        />
      </Row>

    </section>
  );
}

interface AppearanceTabProps {
  theme: Theme;
  onSetTheme: (theme: Theme) => void;
  settings: Settings;
  onUpdateSetting: SettingsDialogProps["onUpdateSetting"];
}

function AppearanceTab({ theme, onSetTheme, settings, onUpdateSetting }: AppearanceTabProps) {
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

interface ExportTabProps {
  settings: Settings;
  onUpdateSetting: SettingsDialogProps["onUpdateSetting"];
}

function ExportTab({ settings, onUpdateSetting }: ExportTabProps) {
  return (
    <section>
      <Row label="Default format">
        <Select
          value={settings.defaultExportFormat}
          onValueChange={(value) => {
            onUpdateSetting("defaultExportFormat", value as ExportFormat);
          }}
        >
          <SelectTrigger className="w-32" aria-label="Default export format">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pdf">PDF</SelectItem>
            <SelectItem value="latex">LaTeX</SelectItem>
            <SelectItem value="html">HTML</SelectItem>
          </SelectContent>
        </Select>
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
        <p className="text-sm text-[var(--cf-muted)]">No plugins registered.</p>
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
            className="flex items-center justify-between py-2 border-b border-[var(--cf-border)] last:border-b-0"
          >
            <div className="flex flex-col">
              <span className="text-sm font-medium text-[var(--cf-fg)]">{plugin.name}</span>
              {plugin.description && (
                <span className="text-xs text-[var(--cf-muted)]">{plugin.description}</span>
              )}
            </div>
            <Checkbox
              checked={isEnabled}
              aria-label={`Enable ${plugin.name}`}
              onCheckedChange={() => {
                onUpdateSetting("enabledPlugins", {
                  ...settings.enabledPlugins,
                  [plugin.id]: !isEnabled,
                });
              }}
              className="ml-4 shrink-0"
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[80vh] w-[560px] flex-col overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>

        <DialogHeader>
          <h2 className="text-base font-semibold text-[var(--cf-fg)]">Settings</h2>
          <DialogCloseButton aria-label="Close settings" />
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as SettingsTab)}
          orientation="vertical"
          className="flex flex-1 overflow-hidden"
        >
          <TabsList className="flex w-36 shrink-0 flex-col items-stretch border-r border-[var(--cf-border)] bg-[var(--cf-bg)] py-2">
            {TABS.map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className={cn(
                  "justify-start rounded-none border-b-0 px-4 py-2 text-left text-sm normal-case tracking-normal",
                  "data-[state=active]:border-b-0 data-[state=active]:bg-[var(--cf-bg)]",
                  "data-[state=active]:font-medium",
                )}
              >
                {tab}
              </TabsTrigger>
            ))}
          </TabsList>

          <ScrollArea className="flex-1" viewportClassName="px-5 py-4">
            <TabsContent value="General">
              <GeneralTab settings={settings} onUpdateSetting={onUpdateSetting} />
            </TabsContent>
            <TabsContent value="Editor">
              <EditorTab settings={settings} onUpdateSetting={onUpdateSetting} />
            </TabsContent>
            <TabsContent value="Appearance">
              <AppearanceTab
                theme={theme}
                onSetTheme={onSetTheme}
                settings={settings}
                onUpdateSetting={onUpdateSetting}
              />
            </TabsContent>
            <TabsContent value="Plugins">
              <PluginsTab settings={settings} onUpdateSetting={onUpdateSetting} plugins={plugins} />
            </TabsContent>
            <TabsContent value="Export">
              <ExportTab settings={settings} onUpdateSetting={onUpdateSetting} />
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
