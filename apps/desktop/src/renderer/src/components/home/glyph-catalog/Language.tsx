import type { LanguageCoverage } from "@shift/glyph-info";
import { SidebarRowButton } from "@/components/sidebar";

export interface LanguageProps {
  coverage: LanguageCoverage;
  isActive: boolean;
  onSelect: (languageId: string) => void;
}

export const Language = ({ coverage, isActive, onSelect }: LanguageProps) => {
  const { language, presentCount, requiredCount } = coverage;

  return (
    <SidebarRowButton
      className="pl-7"
      isActive={isActive}
      onClick={() => onSelect(language.id)}
      title={language.autonym ?? undefined}
    >
      <span className="min-w-0 flex-1 truncate text-left">{language.name}</span>
      <span className="shrink-0 text-xs text-secondary">
        {presentCount}/{requiredCount}
      </span>
    </SidebarRowButton>
  );
};
