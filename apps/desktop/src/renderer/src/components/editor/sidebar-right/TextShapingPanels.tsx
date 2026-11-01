import { useMemo } from "react";
import type { Language, LanguageCatalog } from "@shift/glyph-info";
import type { RunId } from "@shift/types";
import { useSignalState } from "@shift/editor/signals";
import type { LanguageChoices, PickerChoice } from "@/types/sidebarPicker";
import { useEditor } from "@/workspace/WorkspaceContext";
import { getGlyphInfo } from "@/workspace/glyphInfo";
import { PickerPanel } from "./SidebarPicker";

/** What an unset language or script shows. */
export const UNSET = "None";

interface LanguagePanelProps {
  readonly current: string | null;
  readonly onPick: (language: string | null) => void;
}

/**
 * The languages to shape as, which pick the font's `locl` rules. Keyed by
 * Hyperglot orthography, since one language can be written in two scripts;
 * picking one sets its BCP 47 tag.
 */
export const LanguagePanel = ({ current, onPick }: LanguagePanelProps) => {
  const catalog = useLanguageCatalog();
  const { choices, tags } = useMemo(() => languageChoices(catalog), [catalog]);
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
      noneLabel={UNSET}
      onPick={(key) => onPick(key === null ? null : (tags.get(key) ?? null))}
    />
  );
};

interface ScriptPanelProps {
  readonly runId: RunId;
  readonly current: string | null;
  readonly onPick: (script: string | null) => void;
}

/**
 * The scripts to shape the whole text in: those the font has letters for,
 * and any the text uses. None shapes each stretch in its own characters' script.
 */
export const ScriptPanel = ({ runId, current, onPick }: ScriptPanelProps) => {
  const editor = useEditor();
  const detected = useSignalState(editor.text.scriptsCell(runId));
  const catalog = useLanguageCatalog();
  const choices = useMemo(
    () => scriptChoices(catalog, detected, current),
    [catalog, current, detected],
  );

  return (
    <PickerPanel
      title="Script"
      searchLabel="Search scripts"
      choices={choices}
      current={current}
      noneLabel={UNSET}
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

/** Every language with a BCP 47 tag, by name, and the tag each choice sets. */
function languageChoices(catalog: LanguageCatalog): LanguageChoices {
  const tags = new Map<string, string>();
  const choices: PickerChoice[] = [];
  for (const script of catalog.scripts) {
    for (const { language } of script.languages) {
      const tag = languageTag(language);
      if (!tag) continue;

      tags.set(language.id, tag);
      choices.push({ key: language.id, label: language.name, detail: language.script });
    }
  }
  return { choices: choices.toSorted(byLabel), tags };
}

/** The scripts the font has letters for, those the text uses, and the chosen one, by name. */
function scriptChoices(
  catalog: LanguageCatalog,
  detected: readonly string[],
  current: string | null,
): PickerChoice[] {
  const codes = new Set<string>(detected);
  if (current) codes.add(current);
  for (const entry of catalog.scripts) {
    const supported = entry.languages.some((coverage) => coverage.presentCount > 0);
    const code = entry.languages[0]?.language.scriptCode;
    if (supported && code) codes.add(code);
  }
  return [...codes].map((code) => ({ key: code, label: scriptName(code) })).toSorted(byLabel);
}

function byLabel(left: PickerChoice, right: PickerChoice): number {
  return left.label.localeCompare(right.label);
}

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

/** A language tag's English name, or {@link UNSET}. */
export function languageLabel(language: string | null): string {
  if (language === null) return UNSET;

  try {
    return languageNames.of(language) ?? language;
  } catch {
    return language;
  }
}

/** An ISO 15924 script code's English name, such as "Arabic" for `Arab`. */
export function scriptName(code: string): string {
  try {
    return scriptNames.of(code) ?? code;
  } catch {
    return code;
  }
}
