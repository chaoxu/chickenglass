import type { Settings } from "../../lib/types";
import { Checkbox } from "../ui/checkbox";

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
