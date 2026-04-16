import type { Settings } from "../../lib/types";
import { Checkbox } from "../ui/checkbox";
import { Section } from "./shared";

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

interface PluginsTabProps {
  settings: Settings;
  onUpdateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  plugins: PluginInfo[];
}

export function PluginsTab({ settings, onUpdateSetting, plugins }: PluginsTabProps) {
  if (plugins.length === 0) {
    return (
      <Section title="Plugins">
        <p className="text-sm text-[var(--cf-muted)]">No plugins registered.</p>
      </Section>
    );
  }

  return (
    <Section
      title="Plugins"
      description="Toggle optional editor extensions. Disabled plugins are not loaded into the document."
    >
      <div className="rounded-md border border-[var(--cf-border)] divide-y divide-[var(--cf-border)] overflow-hidden">
        {plugins.map(({ plugin }) => {
          const isEnabled = settings.enabledPlugins[plugin.id] ?? plugin.defaultEnabled;
          return (
            <div
              key={plugin.id}
              className="flex items-center justify-between gap-4 px-3 py-2.5 hover:bg-[var(--cf-hover)] transition-colors"
            >
              <div className="min-w-0 flex flex-col">
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
                className="shrink-0"
              />
            </div>
          );
        })}
      </div>
    </Section>
  );
}
