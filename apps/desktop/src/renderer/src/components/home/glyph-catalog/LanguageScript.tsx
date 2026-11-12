import type { LanguageScript as LanguageScriptGroup, RequiredGlyph } from "@shift/glyph-info";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@shift/ui";
import ChevronRightIcon from "@/assets/general/chevron-right.svg";
import { SidebarActionSlot, SidebarRowButton } from "@/components/sidebar";
import type { LanguageGlyph } from "@/types/glyphCatalog";
import { Language } from "./Language";
import { languageTooltip } from "./languageText";
import { ScriptIcon } from "./ScriptIcon";
import { ScriptLanguagePicker } from "./ScriptLanguagePicker";

export interface LanguageScriptProps {
  group: LanguageScriptGroup;
  /** Every language written in the script, for adding more of them. */
  allLanguages: LanguageScriptGroup;
  trackedLanguageIds: readonly string[];
  onTrackLanguages: (languageIds: readonly string[]) => void;
  selectedLanguageId: string | null;
  canGenerate: boolean;
  onSelectLanguage: (setId: string) => void;
  languageGlyphs: (setId: string) => LanguageGlyph[];
  onGenerate: (glyphs: readonly RequiredGlyph[]) => void;
}

export const LanguageScript = ({
  group,
  allLanguages,
  trackedLanguageIds,
  onTrackLanguages,
  selectedLanguageId,
  canGenerate,
  onSelectLanguage,
  languageGlyphs,
  onGenerate,
}: LanguageScriptProps) => (
  <Collapsible className="flex flex-col">
    {/* One hover background for the row and its +, as SidebarActionRow draws it. */}
    <div className="group flex h-7 w-full min-w-0 items-center rounded transition-colors hover:bg-hover/50">
      <CollapsibleTrigger
        render={<SidebarRowButton variant="transparent" className="w-auto min-w-0 flex-1" />}
      >
        <div className="flex min-w-0 items-center gap-1">
          <ChevronRightIcon className="h-3 w-3 shrink-0 transition-transform duration-175 group-data-[panel-open]:rotate-90 group-data-[panel-closed]:rotate-0" />
          <ScriptIcon script={group.script} />
          <span className="truncate">{group.script}</span>
        </div>
      </CollapsibleTrigger>
      <SidebarActionSlot>
        <ScriptLanguagePicker
          script={allLanguages}
          trackedLanguageIds={trackedLanguageIds}
          disabled={!canGenerate}
          onApply={onTrackLanguages}
        />
      </SidebarActionSlot>
    </div>
    <CollapsiblePanel>
      <div className="flex flex-col gap-1 pt-1">
        {group.groups.map(({ group: scriptGroup, presentCount, requiredCount }) => (
          <Language
            key={scriptGroup.id}
            setId={scriptGroup.id}
            name={scriptGroup.name}
            presentCount={presentCount}
            requiredCount={requiredCount}
            isActive={selectedLanguageId === scriptGroup.id}
            canGenerate={canGenerate}
            onSelect={onSelectLanguage}
            languageGlyphs={languageGlyphs}
            onGenerate={onGenerate}
          />
        ))}
        {group.languages.map((coverage) => (
          <Language
            key={coverage.language.id}
            setId={coverage.language.id}
            name={coverage.language.name}
            title={languageTooltip(coverage)}
            presentCount={coverage.presentCount}
            requiredCount={coverage.requiredCount}
            isActive={selectedLanguageId === coverage.language.id}
            canGenerate={canGenerate}
            onSelect={onSelectLanguage}
            languageGlyphs={languageGlyphs}
            onGenerate={onGenerate}
          />
        ))}
      </div>
    </CollapsiblePanel>
  </Collapsible>
);
