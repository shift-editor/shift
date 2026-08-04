import { useParams } from "react-router";
import { SidebarSection } from "./SidebarSection";
import { useGlyphCatalog } from "@/context/GlyphCatalogContext";
import { formatCodepointAsUPlus } from "@/lib/utils/unicode";

/** Passive selected-glyph details shared by retained source sessions. */
export const DisplayGlyphSection = () => {
  const { glyphId } = useParams();
  const { availableGlyphs, openedGlyph } = useGlyphCatalog();
  const glyphIndex = glyphId === undefined ? null : Number(glyphId);
  const glyph =
    glyphIndex === null || !Number.isSafeInteger(glyphIndex)
      ? null
      : (availableGlyphs.find((candidate) => candidate.id === glyphIndex) ?? null);

  return (
    <SidebarSection title="Glyph">
      {glyph && openedGlyph ? (
        <div className="flex flex-col gap-2 text-ui">
          <div className="font-medium text-primary">{glyph.name}</div>
          <div className="font-mono text-muted">
            {glyph.unicode === null ? "Unencoded" : formatCodepointAsUPlus(glyph.unicode)}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted">Advance</span>
            <span className="font-mono text-primary">{Math.round(openedGlyph.xAdvance)}</span>
          </div>
        </div>
      ) : (
        <p className="text-ui text-muted">No glyph selected</p>
      )}
    </SidebarSection>
  );
};
