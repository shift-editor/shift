import { useRef, useState } from "react";
import type { RequiredGlyph } from "@shift/glyph-info";
import { SidebarRowButton } from "@/components/sidebar";
import type { LanguageGlyph } from "@/types/glyphCatalog";
import { GuideSlot } from "@/components/editor/object-tree/ObjectSectionRow";
import { MissingGlyphsPopover } from "./MissingGlyphsPopover";

export interface LanguageProps {
  /** A language id (`arb-arabic`) or script group id (`arabic/basic-shapes`). */
  setId: string;
  name: string;
  /** Shown on hover, such as a language's autonym. */
  title?: string;
  presentCount: number;
  requiredCount: number;
  isActive: boolean;
  canGenerate: boolean;
  onSelect: (setId: string) => void;
  languageGlyphs: (setId: string) => LanguageGlyph[];
  onGenerate: (glyphs: readonly RequiredGlyph[]) => void;
}

/** One language or script group row: selects its glyphs, and lists what is missing on right-click. */
export const Language = ({
  setId,
  name,
  title,
  presentCount,
  requiredCount,
  isActive,
  canGenerate,
  onSelect,
  languageGlyphs,
  onGenerate,
}: LanguageProps) => {
  const rowRef = useRef<HTMLButtonElement>(null);
  const [glyphs, setGlyphs] = useState<LanguageGlyph[] | null>(null);

  return (
    <>
      <SidebarRowButton
        ref={rowRef}
        isActive={isActive}
        onClick={() => onSelect(setId)}
        onContextMenu={(event) => {
          event.preventDefault();
          setGlyphs(languageGlyphs(setId));
        }}
        title={title}
      >
        <GuideSlot className="-ml-2" />
        <span className="min-w-0 flex-1 truncate pl-5 text-left">{name}</span>
        <span className="shrink-0 text-xs">
          {presentCount}/{requiredCount}
        </span>
      </SidebarRowButton>
      <MissingGlyphsPopover
        anchor={rowRef}
        languageName={name}
        glyphs={glyphs}
        canGenerate={canGenerate}
        onClose={() => setGlyphs(null)}
        onGenerate={onGenerate}
      />
    </>
  );
};
