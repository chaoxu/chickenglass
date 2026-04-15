import { useState } from "react";
import {
  SlidersHorizontal,
  Type,
  Palette,
  Puzzle,
  FileOutput,
  type LucideIcon,
} from "lucide-react";
import type { Settings, Theme } from "../lib/types";
import { cn } from "../lib/utils";
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { ScrollArea } from "./ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { GeneralTab } from "./settings-tabs/general-tab";
import { EditorTab } from "./settings-tabs/editor-tab";
import { AppearanceTab } from "./settings-tabs/appearance-tab";
import { PluginsTab } from "./settings-tabs/plugins-tab";
import type { PluginInfo } from "./settings-tabs/plugins-tab";
import { ExportTab } from "./settings-tabs/export-tab";

// ── Types ─────────────────────────────────────────────────────────────────────

type SettingsTab = "General" | "Editor" | "Appearance" | "Plugins" | "Export";

export type { PluginInfo };

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
  onUpdateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  theme: Theme;
  onSetTheme: (theme: Theme) => void;
  plugins?: PluginInfo[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

interface TabSpec {
  id: SettingsTab;
  icon: LucideIcon;
  blurb: string;
}

const TABS: readonly TabSpec[] = [
  { id: "General", icon: SlidersHorizontal, blurb: "Auto-save and core defaults." },
  { id: "Editor", icon: Type, blurb: "Typography, layout, and reveal behavior." },
  { id: "Appearance", icon: Palette, blurb: "Theme, fonts, and custom CSS." },
  { id: "Plugins", icon: Puzzle, blurb: "Optional editor extensions." },
  { id: "Export", icon: FileOutput, blurb: "Default export format." },
];

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
  const activeSpec = TABS.find((t) => t.id === activeTab) ?? TABS[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(640px,85vh)] w-[min(840px,95vw)] flex-col overflow-hidden p-0 shadow-2xl"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>

        <DialogHeader className="px-6 py-4">
          <div className="flex flex-col">
            <h2 className="text-base font-semibold tracking-tight text-[var(--cf-fg)]">
              Settings
            </h2>
            <p className="text-xs text-[var(--cf-muted)]">
              Saved automatically to this device.
            </p>
          </div>
          <DialogCloseButton aria-label="Close settings" />
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as SettingsTab)}
          orientation="vertical"
          className="flex flex-1 overflow-hidden"
        >
          <TabsList
            className={cn(
              "flex w-44 shrink-0 flex-col items-stretch gap-0.5 overflow-hidden",
              "border-r border-[var(--cf-border)] bg-[var(--cf-bg-soft,var(--cf-bg))] px-2 py-3",
            )}
          >
            {TABS.map(({ id, icon: Icon }) => (
              <TabsTrigger
                key={id}
                value={id}
                className={cn(
                  // override base horizontal-tab styles from ui/tabs
                  "group relative flex-none justify-start gap-2.5 rounded-md border-0 px-2.5 py-1.5",
                  "text-[13px] font-medium normal-case tracking-normal text-[var(--cf-muted)]",
                  "transition-colors duration-[var(--cf-transition)]",
                  "hover:bg-[var(--cf-hover)] hover:text-[var(--cf-fg)]",
                  "data-[state=active]:bg-[var(--cf-hover)] data-[state=active]:text-[var(--cf-fg)]",
                  "data-[state=active]:before:absolute data-[state=active]:before:left-0",
                  "data-[state=active]:before:top-1/2 data-[state=active]:before:h-4",
                  "data-[state=active]:before:w-[3px] data-[state=active]:before:-translate-y-1/2",
                  "data-[state=active]:before:rounded-r-full data-[state=active]:before:bg-[var(--cf-accent)]",
                )}
              >
                <Icon size={14} className="shrink-0 opacity-80" aria-hidden="true" />
                <span>{id}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="border-b border-[var(--cf-border)] px-6 py-3">
              <h3 className="text-sm font-semibold text-[var(--cf-fg)]">{activeSpec.id}</h3>
              <p className="text-xs text-[var(--cf-muted)]">{activeSpec.blurb}</p>
            </div>
            <ScrollArea className="flex-1" viewportClassName="px-6 py-5">
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
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
