import type { LanguageScript as LanguageScriptGroup, RequiredGlyph } from "@shift/glyph-info";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@shift/ui";
import ChevronRightIcon from "@/assets/general/chevron-right.svg";
import { SidebarRowButton } from "@/components/sidebar";
import type { LanguageGlyph } from "@/types/glyphCatalog";
import { Language } from "./Language";
import { ScriptIcon } from "./ScriptIcon";

export interface LanguageScriptProps {
  group: LanguageScriptGroup;
  selectedLanguageId: string | null;
  canGenerate: boolean;
  onSelectLanguage: (setId: string) => void;
  languageGlyphs: (setId: string) => LanguageGlyph[];
  onGenerate: (glyphs: readonly RequiredGlyph[]) => void;
}

export const LanguageScript = ({
  group,
  selectedLanguageId,
  canGenerate,
  onSelectLanguage,
  languageGlyphs,
  onGenerate,
}: LanguageScriptProps) => (
  <Collapsible className="flex flex-col">
    <CollapsibleTrigger render={<SidebarRowButton />}>
      <div className="flex min-w-0 items-center gap-1">
        <ChevronRightIcon className="h-3 w-3 shrink-0 transition-transform duration-175 group-data-[panel-open]:rotate-90 group-data-[panel-closed]:rotate-0" />
        <ScriptIcon script={group.script} />
        <span className="truncate">{group.script}</span>
      </div>
    </CollapsibleTrigger>
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
        {group.languages.map(({ language, presentCount, requiredCount }) => (
          <Language
            key={language.id}
            setId={language.id}
            name={language.name}
            title={language.autonym ?? undefined}
            presentCount={presentCount}
            requiredCount={requiredCount}
            isActive={selectedLanguageId === language.id}
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
