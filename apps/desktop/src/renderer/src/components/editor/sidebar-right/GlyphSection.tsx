import { useParams } from "react-router";
import { asGlyphId } from "@shift/types";
import PlaceholderGlyph from "@/assets/sidebar-right/placeholder-glyph.svg";
import { useGlyphCatalog } from "@/context/GlyphCatalogContext";
import { useGlyphSidebearings } from "@/hooks/useGlyphSidebearings";
import { useGlyphXAdvance } from "@/hooks/useGlyphXAdvance";
import { formatCodepointAsUPlus } from "@/lib/utils/unicode";
import { useEditor } from "@/workspace/WorkspaceContext";
import { EditableSidebarInput } from "./EditableSidebarInput";
import { SidebarSection } from "./SidebarSection";

/** Source-neutral selected-glyph inspection with authored-only mutations. */
export const GlyphSection = () => {
  const { glyphId: glyphIdParam } = useParams();
  const { availableGlyphs } = useGlyphCatalog();
  const editor = useEditor();
  const sidebearings = useGlyphSidebearings();
  const xAdvance = useGlyphXAdvance();
  const glyphId = glyphIdParam ? asGlyphId(glyphIdParam) : null;
  const glyph = glyphId
    ? (availableGlyphs.find((candidate) => candidate.id === glyphId) ?? null)
    : null;
  if (!glyph) return null;

  const leftSidebearing =
    sidebearings.sidebearings.lsb === null ? null : Math.round(sidebearings.sidebearings.lsb);
  const rightSidebearing =
    sidebearings.sidebearings.rsb === null ? null : Math.round(sidebearings.sidebearings.rsb);
  const sidebearingsEditable =
    sidebearings.hasLayer && leftSidebearing !== null && rightSidebearing !== null;
  const unicode =
    glyph.unicode === null || glyph.unicode === undefined
      ? "Unencoded"
      : formatCodepointAsUPlus(glyph.unicode);

  return (
    <SidebarSection title="Glyph">
      <main className="flex flex-col items-center">
        <div className="flex flex-col items-center gap-0.5 mb-2">
          <div className="font-mono text-sm">{unicode}</div>
        </div>
        <div className="flex justify-center items-center gap-2">
          <div className="contents">
            <EditableSidebarInput
              label="LSB"
              className="text-right"
              value={leftSidebearing}
              disabled={!sidebearingsEditable}
              onValueChange={
                sidebearingsEditable ? (value) => editor.setLeftSidebearing(value) : undefined
              }
            />
          </div>
          <div className="px-2">
            <PlaceholderGlyph />
          </div>
          <div className="contents">
            <EditableSidebarInput
              label="RSB"
              labelPosition="right"
              className="text-left"
              value={rightSidebearing}
              disabled={!sidebearingsEditable}
              onValueChange={
                sidebearingsEditable ? (value) => editor.setRightSidebearing(value) : undefined
              }
            />
          </div>
        </div>
        <div className="mt-2">
          <EditableSidebarInput
            className="text-center"
            value={Math.round(xAdvance.xAdvance)}
            disabled={!xAdvance.hasLayer}
            onValueChange={xAdvance.hasLayer ? (value) => editor.setXAdvance(value) : undefined}
          />
        </div>
        <div className="font-sans mt-2 text-sm">{glyph.displayName}</div>
      </main>
    </SidebarSection>
  );
};
