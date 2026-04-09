import type { PluginRenderAdapter } from "../plugins/plugin-render-adapter";
import { codeMirrorPluginRenderAdapter } from "../render/plugin-render-adapter";

export const pluginRenderAdapter: PluginRenderAdapter = codeMirrorPluginRenderAdapter;
