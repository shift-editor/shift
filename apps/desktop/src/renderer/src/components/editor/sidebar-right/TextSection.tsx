import { useMemo } from "react";
import type { Language, LanguageCatalog } from "@shift/glyph-info";
import type { TextAlign, TextRunRecord } from "@shift/editor/text";
import type { TextRunNode } from "@shift/editor/types";
import type { RunId } from "@shift/types";
import { useSignalState } from "@shift/editor/signals";
import { Button, Tooltip } from "@shift/ui";
import AlignLeftIcon from "@/assets/general/align-left.svg";
import AlignCenterIcon from "@/assets/general/align-center.svg";
import AlignRightIcon from "@/assets/general/align-right.svg";
import FontSizeIcon from "@/assets/general/font-size.svg";
import LineHeightIcon from "@/assets/general/line-height.svg";
import ShapingOffIcon from "@/assets/general/shaping-off.svg";
import ShapingOnIcon from "@/assets/general/shaping-on.svg";
import { useEditor } from "@/workspace/WorkspaceContext";
import { getGlyphInfo } from "@/workspace/glyphInfo";
import { IconButton } from "./IconButton";
import { SidebarNumberField } from "./SidebarNumberField";
import { PickerPanel, SidebarPicker, type PickerChoice } from "./SidebarPicker";
import { SidebarSection } from "./SidebarSection";

/**
 * The proof text the text settings apply to, and its placed node; null
 * while editing a glyph inside it, since the settings are for the text.
 */
export function useTextSettingsRun(): { run: TextRunRecord; node: TextRunNode } | null {
  const editor = useEditor();
  const run = useSignalState(editor.text.currentRunCell);
  const node = useSignalState(editor.text.currentRunNodeCell);
  const textTool = useSignalState(editor.toolIdCell) === "text";
  const typing = useSignalState(editor.textEditing.stateCell) !== null;
  if (!run || !node || !(textTool || typing)) return null;
  return { run, node };
}

/**
 * Settings for the proof text the user is working in: size and line height
 * as number fields, then labelled rows. Features have their own section.
 */
export const TextSection = () => {
  const editor = useEditor();
  const target = useTextSettingsRun();
  if (!target) return null;
  const { run, node } = target;

  const capture = (label: string, change: () => void) => editor.history.capture(label, change);

  return (
    <SidebarSection
      title="Text"
      actions={
        <ShapingToggle
          on={run.shaping}
          onChange={(shaping) =>
            capture(shaping ? "Turn shaping on" : "Turn shaping off", () =>
              editor.text.setShaping(run.id, shaping),
            )
          }
        />
      }
    >
      <div className="flex gap-2">
        <SidebarNumberField
          ariaLabel="Font size"
          label={<FontSizeIcon aria-hidden className="size-4" />}
          value={node.size}
          onValueCommit={(size) =>
            capture("Set font size", () =>
              editor.scene.updateNode({ id: node.id, size: Math.max(1, size) }),
            )
          }
        />
        <SidebarNumberField
          ariaLabel="Line height"
          label={<LineHeightIcon aria-hidden className="size-4" />}
          value={run.lineHeight}
          placeholder="Auto"
          onValueCommit={(lineHeight) =>
            capture("Set line height", () =>
              editor.text.setLineHeight(run.id, Math.max(0.1, lineHeight)),
            )
          }
          onClear={() => capture("Set line height", () => editor.text.setLineHeight(run.id, null))}
        />
      </div>
      <Row label="Alignment">
        <AlignButtons
          runId={run.id}
          align={run.align}
          onChange={(align) => capture("Align text", () => editor.text.setAlign(run.id, align))}
        />
      </Row>
      <Row label="Language">
        <SidebarPicker
          label="Language"
          value={languageLabel(run.language)}
          unset={run.language === null}
          panel={(close) => (
            <LanguagePanel
              current={run.language}
              onPick={(language) => {
                close();
                capture("Set text language", () => editor.text.setLanguage(run.id, language));
              }}
            />
          )}
        />
      </Row>
      <Row label="Script">
        <SidebarPicker
          label="Script"
          value={run.script ? scriptName(run.script) : NONE}
          unset={run.script === null}
          panel={(close) => (
            <ScriptPanel
              runId={run.id}
              current={run.script}
              onPick={(script) => {
                close();
                capture("Set text script", () => editor.text.setScript(run.id, script));
              }}
            />
          )}
        />
      </Row>
    </SidebarSection>
  );
};

/**
 * Turns shaping on or off for the text: pressed, with the fi ligature, while
 * on; off shows f and i apart, as the text then sets them.
 */
const ShapingToggle = ({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) => {
  const Icon = on ? ShapingOnIcon : ShapingOffIcon;
  return (
    <Tooltip content="Shaping">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Shaping"
        aria-pressed={on}
        isActive={on}
        className="text-sidebar-icon"
        onClick={() => onChange(!on)}
      >
        <Icon aria-hidden className="h-4 w-4" />
      </Button>
    </Tooltip>
  );
};

/** A setting's label, and its control at the row's end. */
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex h-6 items-center justify-between gap-4 text-ui">
    <span className="shrink-0 text-secondary">{label}</span>
    {children}
  </div>
);

/** What an unset language or script shows. */
const NONE = "None";

/**
 * The languages to shape as, which pick the font's `locl` rules. Keyed by
 * Hyperglot orthography, since one language can be written in two scripts;
 * picking one sets its BCP 47 tag.
 */
const LanguagePanel = ({
  current,
  onPick,
}: {
  current: string | null;
  onPick: (language: string | null) => void;
}) => {
  const catalog = useLanguageCatalog();
  const { choices, tags } = useMemo(() => {
    const tagById = new Map<string, string>();
    const list: PickerChoice[] = [];
    for (const script of catalog.scripts) {
      for (const { language } of script.languages) {
        const tag = languageTag(language);
        if (!tag) continue;
        tagById.set(language.id, tag);
        list.push({ key: language.id, label: language.name, detail: language.script });
      }
    }
    list.sort((left, right) => left.label.localeCompare(right.label));
    return { choices: list, tags: tagById };
  }, [catalog]);
  const currentKey =
    current === null
      ? null
      : (choices.find((choice) => tags.get(choice.key) === current)?.key ?? null);

  return (
    <PickerPanel
      title="Language"
      searchLabel="Search languages"
      choices={choices}
      current={currentKey}
      noneLabel={NONE}
      onPick={(key) => onPick(key === null ? null : (tags.get(key) ?? null))}
    />
  );
};

/**
 * The scripts to shape the whole text in: those the font has letters for,
 * and any the text uses. None shapes each stretch in its own characters' script.
 */
const ScriptPanel = ({
  runId,
  current,
  onPick,
}: {
  runId: RunId;
  current: string | null;
  onPick: (script: string | null) => void;
}) => {
  const editor = useEditor();
  const detected = useSignalState(editor.text.scriptsCell(runId));
  const catalog = useLanguageCatalog();
  const choices = useMemo<PickerChoice[]>(() => {
    const codes = new Set<string>(detected);
    if (current) codes.add(current);
    for (const entry of catalog.scripts) {
      const supported = entry.languages.some((coverage) => coverage.presentCount > 0);
      const code = entry.languages[0]?.language.scriptCode;
      if (supported && code) codes.add(code);
    }
    return [...codes]
      .map((code) => ({ key: code, label: scriptName(code) }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [catalog, current, detected]);

  return (
    <PickerPanel
      title="Script"
      searchLabel="Search scripts"
      choices={choices}
      current={current}
      noneLabel={NONE}
      onPick={onPick}
    />
  );
};

/** Hyperglot's languages with how much of each the font covers, rebuilt when its glyphs change. */
function useLanguageCatalog(): LanguageCatalog {
  const editor = useEditor();
  const entries = useSignalState(editor.font.glyphEntriesCell);
  return useMemo(
    () => getGlyphInfo().createLanguageCatalog(entries.flatMap((entry) => [...entry.unicodes])),
    [entries],
  );
}

const ALIGNMENTS: readonly { align: TextAlign; label: string; Icon: typeof AlignLeftIcon }[] = [
  { align: "left", label: "Align left", Icon: AlignLeftIcon },
  { align: "center", label: "Align center", Icon: AlignCenterIcon },
  { align: "right", label: "Align right", Icon: AlignRightIcon },
];

/** How lines line up; until one is chosen, each line follows its direction. */
const AlignButtons = ({
  runId,
  align,
  onChange,
}: {
  runId: RunId;
  align: TextAlign | null;
  onChange: (align: TextAlign) => void;
}) => {
  const editor = useEditor();
  const direction = useSignalState(editor.text.directionCell(runId));
  const shown = align ?? (direction === "rtl" ? "right" : "left");

  return (
    <div className="flex gap-1" role="group" aria-label="Text alignment">
      {ALIGNMENTS.map(({ align: option, label, Icon }) => (
        <IconButton
          key={option}
          ariaLabel={label}
          icon={Icon}
          pressed={shown === option}
          onClick={() => onChange(option)}
        />
      ))}
    </div>
  );
};

/** The BCP 47 tag for a Hyperglot language: its ISO 639 code in shortest form (`urd` → `ur`). */
function languageTag(language: Language): string | null {
  const code = language.id.split("-")[0];
  if (!code) return null;
  try {
    return Intl.getCanonicalLocales(code)[0] ?? null;
  } catch {
    return null;
  }
}

const languageNames = new Intl.DisplayNames(["en"], { type: "language" });
const scriptNames = new Intl.DisplayNames(["en"], { type: "script" });

function languageLabel(language: string | null): string {
  if (language === null) return NONE;
  try {
    return languageNames.of(language) ?? language;
  } catch {
    return language;
  }
}

function scriptName(code: string): string {
  try {
    return scriptNames.of(code) ?? code;
  } catch {
    return code;
  }
}
