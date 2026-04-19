import type { Settings } from "./lib/types";

export interface EditorPlugin {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly defaultEnabled: boolean;
}

interface PluginEntry {
  readonly plugin: EditorPlugin;
  enabled: boolean;
}

export class EditorPluginManager {
  private readonly entries = new Map<string, PluginEntry>();

  constructor(plugins: readonly EditorPlugin[] = []) {
    for (const plugin of plugins) {
      this.register(plugin);
    }
  }

  register(plugin: EditorPlugin): void {
    if (this.entries.has(plugin.id)) {
      return;
    }
    this.entries.set(plugin.id, {
      plugin,
      enabled: plugin.defaultEnabled,
    });
  }

  setEnabled(_target: unknown, id: string, enabled: boolean): void {
    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }
    entry.enabled = enabled;
  }

  toggle(_target: unknown, id: string): void {
    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }
    entry.enabled = !entry.enabled;
  }

  isEnabled(id: string): boolean {
    return this.entries.get(id)?.enabled ?? false;
  }

  getPlugins(): Array<{ plugin: EditorPlugin; enabled: boolean }> {
    return Array.from(this.entries.values()).map(({ plugin, enabled }) => ({
      plugin,
      enabled,
    }));
  }
}

export const defaultEditorPlugins = [
  {
    id: "spellcheck",
    name: "Spellcheck",
    description: "Use the browser spellchecker inside the Lexical editor surface.",
    defaultEnabled: false,
  },
] as const satisfies readonly EditorPlugin[];

export function resolvePluginEnabled(
  settings: Pick<Settings, "enabledPlugins">,
  plugin: EditorPlugin,
): boolean {
  return settings.enabledPlugins[plugin.id] ?? plugin.defaultEnabled;
}

export function isPluginEnabled(
  settings: Pick<Settings, "enabledPlugins">,
  pluginId: string,
  plugins: readonly EditorPlugin[] = defaultEditorPlugins,
): boolean {
  const plugin = plugins.find((candidate) => candidate.id === pluginId);
  return plugin ? resolvePluginEnabled(settings, plugin) : false;
}
