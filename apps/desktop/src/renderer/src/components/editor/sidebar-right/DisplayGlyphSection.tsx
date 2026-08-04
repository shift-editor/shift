import { useParams } from "react-router";
import { asGlyphIndex } from "@shift/types";
import PlaceholderGlyph from "@/assets/sidebar-right/placeholder-glyph.svg";
import { useGlyphCatalog } from "@/context/GlyphCatalogContext";
import { formatCodepointAsUPlus } from "@/lib/utils/unicode";
import { EditableSidebarInput } from "./EditableSidebarInput";
import { SidebarSection } from "./SidebarSection";

/** Authored Glyph sidebar presentation backed by retained display values. */
export const DisplayGlyphSection = () => {
  const { glyphId } = useParams();
  const { availableGlyphs, openedGlyph } = useGlyphCatalog();
  const parsedIndex = glyphId === undefined ? Number.NaN : Number(glyphId);
  const glyphIndex =
    Number.isSafeInteger(parsedIndex) && parsedIndex >= 0 ? asGlyphIndex(parsedIndex) : null;
  const glyph =
    glyphIndex === null
      ? null
      : (availableGlyphs.find((candidate) => candidate.id === glyphIndex) ?? null);
  const bounds = openedGlyph?.bounds ?? null;
  const leftSidebearing = bounds ? Math.round(bounds.min.x) : null;
  const rightSidebearing =
    bounds && openedGlyph ? Math.round(openedGlyph.xAdvance - bounds.max.x) : null;
  let unicode = "Unencoded";
  let glyphName = "No glyph selected";
  if (glyph) {
    glyphName = glyph.displayName;
    if (glyph.unicode !== null) unicode = formatCodepointAsUPlus(glyph.unicode);
  }

  return (
    <SidebarSection title="Glyph">
      <main className="flex flex-col items-center">
        <div className="flex flex-col items-center gap-0.5 mb-2">
          <div className="font-mono text-sm">{unicode}</div>
        </div>
        <div className="flex justify-center items-center gap-2">
          <div className="contents" data-read-only-mutation>
            <EditableSidebarInput label="LSB" className="text-right" value={leftSidebearing} />
          </div>
          <div className="px-2">
            <PlaceholderGlyph />
          </div>
          <div className="contents" data-read-only-mutation>
            <EditableSidebarInput
              label="RSB"
              labelPosition="right"
              className="text-left"
              value={rightSidebearing}
            />
          </div>
        </div>
        <div className="mt-2" data-read-only-mutation>
          <EditableSidebarInput
            className="text-center"
            value={openedGlyph ? Math.round(openedGlyph.xAdvance) : null}
          />
        </div>
        <div className="font-sans mt-2 text-sm">{glyphName}</div>
      </main>
    </SidebarSection>
  );
};
