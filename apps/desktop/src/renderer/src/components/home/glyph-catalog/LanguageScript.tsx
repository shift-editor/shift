import type { LanguageScript as LanguageScriptGroup } from "@shift/glyph-info";
import { Collapsible, CollapsibleChevron, CollapsiblePanel, CollapsibleTrigger } from "@shift/ui";
import { SidebarRowButton } from "@/components/sidebar";
import { Language } from "./Language";

export interface LanguageScriptProps {
  group: LanguageScriptGroup;
  selectedLanguageId: string | null;
  onSelectLanguage: (languageId: string) => void;
}

export const LanguageScript = ({
  group,
  selectedLanguageId,
  onSelectLanguage,
}: LanguageScriptProps) => (
  <Collapsible className="flex flex-col gap-1">
    <CollapsibleTrigger render={<SidebarRowButton />}>
      <CollapsibleChevron className="shrink-0" />
      <span className="truncate">{group.script}</span>
    </CollapsibleTrigger>
    <CollapsiblePanel>
      <div className="flex flex-col gap-1">
        {group.languages.map((coverage) => (
          <Language
            key={coverage.language.id}
            coverage={coverage}
            isActive={selectedLanguageId === coverage.language.id}
            onSelect={onSelectLanguage}
          />
        ))}
      </div>
    </CollapsiblePanel>
  </Collapsible>
);
