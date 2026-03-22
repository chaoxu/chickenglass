import { Compartment, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/**
 * An EditorPlugin encapsulates a toggleable CM6 feature with a stable identity.
 *
 * Each plugin owns a `Compartment` so it can be activated / deactivated
 * independently without rebuilding the entire editor state.
 */
export interface EditorPlugin {
  /** Stable identifier, e.g. `"focus-mode"`. */
  readonly id: string;
  /** Human-readable name shown in the preferences UI. */
  readonly name: string;
  /** Short description for the preferences UI. */
  readonly description?: string;
  /** Whether the plugin is enabled by default when first registered. */
  readonly defaultEnabled: boolean;
  /**
   * Return the CM6 extensions that implement this feature.
   * Called each time the plugin is activated (initial load and every
   * re-enable after a disable).  Implementations should be pure — return
   * the same logical extension objects across calls where possible.
   */
  extensions(): Extension;
}

/** Runtime state for a registered plugin. */
interface PluginEntry {
  plugin: EditorPlugin;
  compartment: Compartment;
  enabled: boolean;
}

/**
 * Manages a collection of `EditorPlugin` instances and their lifecycle.
 *
 * Usage:
 * ```ts
 * const mgr = new EditorPluginManager([focusModePlugin, spellcheckPlugin]);
 * // Include mgr.initialExtensions() when creating the editor state.
 * // Later:
 * mgr.setEnabled(view, "focus-mode", false);
 * ```
 */
export class EditorPluginManager {
  private readonly entries = new Map<string, PluginEntry>();

  constructor(plugins: EditorPlugin[] = []) {
    for (const plugin of plugins) {
      this.register(plugin);
    }
  }

  /**
   * Register a plugin.  Must be called before `initialExtensions()` is
   * consumed by the editor.
   */
  register(plugin: EditorPlugin): void {
    if (this.entries.has(plugin.id)) return;
    this.entries.set(plugin.id, {
      plugin,
      compartment: new Compartment(),
      enabled: plugin.defaultEnabled,
    });
  }

  /**
   * Return the flat array of CM6 extensions to include in the editor state.
   * Each plugin's extensions are wrapped in its private `Compartment` so
   * they can be reconfigured later.
   */
  initialExtensions(): Extension[] {
    const result: Extension[] = [];
    for (const entry of this.entries.values()) {
      result.push(
        entry.compartment.of(entry.enabled ? entry.plugin.extensions() : []),
      );
    }
    return result;
  }

  /**
   * Enable or disable a plugin at runtime.
   * Dispatches a `reconfigure` effect on `view`; no-ops if the state is
   * already correct.  If `view` is null (e.g. no file open yet), the
   * enabled state is updated so the next `initialExtensions()` call picks
   * it up correctly — no dispatch is attempted.
   */
  setEnabled(view: EditorView | null, id: string, enabled: boolean): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.enabled === enabled) return;

    entry.enabled = enabled;
    if (view) {
      view.dispatch({
        effects: entry.compartment.reconfigure(
          enabled ? entry.plugin.extensions() : [],
        ),
      });
    }
  }

  /** Toggle a plugin between enabled and disabled. */
  toggle(view: EditorView | null, id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.setEnabled(view, id, !entry.enabled);
  }

  /** Return whether a plugin is currently enabled. */
  isEnabled(id: string): boolean {
    return this.entries.get(id)?.enabled ?? false;
  }

  /** Return all registered plugins in registration order. */
  getPlugins(): Array<{ plugin: EditorPlugin; enabled: boolean }> {
    return Array.from(this.entries.values()).map(({ plugin, enabled }) => ({
      plugin,
      enabled,
    }));
  }
}

