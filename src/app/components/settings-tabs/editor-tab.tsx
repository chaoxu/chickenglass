import type { Settings } from "../../lib/types";
import { Field, Section } from "./shared";
import { Checkbox } from "../ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Slider } from "../ui/slider";
import {
  EDITOR_MODE_LABELS,
  REVEAL_PRESENTATION_LABELS,
  markdownEditorModes,
  revealPresentations,
} from "../../editor-mode";

interface EditorTabProps {
  settings: Settings;
  onUpdateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

export function EditorTab({ settings, onUpdateSetting }: EditorTabProps) {
  return (
    <>
      <Section title="Typography" description="Sizing for the document body.">
        <Field label={`Font size — ${settings.fontSize}px`}>
          <Slider
            aria-label="Font size"
            min={10}
            max={28}
            step={1}
            value={[settings.fontSize]}
            onValueChange={([value]) => { onUpdateSetting("fontSize", value); }}
            className="w-40"
          />
        </Field>
        <Field label={`Line height — ${settings.lineHeight.toFixed(1)}`}>
          <Slider
            aria-label="Line height"
            min={1.2}
            max={2.0}
            step={0.1}
            value={[settings.lineHeight]}
            onValueChange={([value]) => { onUpdateSetting("lineHeight", value); }}
            className="w-40"
          />
        </Field>
      </Section>

      <Section title="Layout">
        <Field label="Tab size">
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
        </Field>
        <Field label="Show line numbers" htmlFor="sd-line-numbers">
          <Checkbox
            id="sd-line-numbers"
            checked={settings.showLineNumbers}
            onCheckedChange={(checked) => { onUpdateSetting("showLineNumbers", checked === true); }}
          />
        </Field>
        <Field label="Word wrap" htmlFor="sd-word-wrap">
          <Checkbox
            id="sd-word-wrap"
            checked={settings.wordWrap}
            onCheckedChange={(checked) => { onUpdateSetting("wordWrap", checked === true); }}
          />
        </Field>
      </Section>

      <Section
        title="Reveal"
        description="How the editor surfaces markdown source for inline elements like math, links, and styled text."
      >
        <Field
          label="Scope"
          description="What gets revealed: just the cursor's run, the current paragraph, or the whole document."
        >
          <Select
            value={settings.editorMode}
            onValueChange={(value) => {
              onUpdateSetting("editorMode", value as Settings["editorMode"]);
            }}
          >
            <SelectTrigger className="w-40" aria-label="Reveal scope">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {markdownEditorModes.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {EDITOR_MODE_LABELS[mode]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field
          label="Presentation"
          description="Inline swaps the rendered subtree for source. Floating opens a small panel above it."
        >
          <Select
            value={settings.revealPresentation}
            onValueChange={(value) => {
              onUpdateSetting("revealPresentation", value as Settings["revealPresentation"]);
            }}
          >
            <SelectTrigger className="w-40" aria-label="Reveal presentation">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {revealPresentations.map((presentation) => (
                <SelectItem key={presentation} value={presentation}>
                  {REVEAL_PRESENTATION_LABELS[presentation]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </Section>
    </>
  );
}
