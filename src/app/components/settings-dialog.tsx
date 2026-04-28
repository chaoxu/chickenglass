import { useState } from "react";
import type { Settings, Theme } from "../lib/types";
import { cn } from "../lib/utils";
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
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

const TABS: SettingsTab[] = ["General", "Editor", "Appearance", "Plugins", "Export"];

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
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Change editor, appearance, plugin, and export preferences.
        </DialogDescription>

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
