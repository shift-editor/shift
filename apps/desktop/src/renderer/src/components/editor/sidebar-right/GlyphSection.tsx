import { useParams } from "react-router";
import { asGlyphId } from "@shift/types";
import PlaceholderGlyph from "@/assets/sidebar-right/placeholder-glyph.svg";
import { useGlyphCatalog } from "@/context/GlyphCatalogContext";
import { formatCodepointAsUPlus } from "@/lib/utils/unicode";
import { useEditor, useFontSession } from "@/workspace/WorkspaceContext";
import { EditableSidebarInput } from "./EditableSidebarInput";
import { SidebarSection } from "./SidebarSection";

/** Source-neutral selected-glyph inspection with authored-only mutations. */
export const GlyphSection = () => {
  const { glyphId: glyphIdParam } = useParams();
  const { availableGlyphs, openedGlyph } = useGlyphCatalog();
  const editor = useEditor();
  const editable = useFontSession().workspace !== null;
  const glyphId = glyphIdParam ? asGlyphId(glyphIdParam) : null;
  const glyph = glyphId
    ? (availableGlyphs.find((candidate) => candidate.id === glyphId) ?? null)
    : null;
  if (!glyph) return null;

  const bounds = openedGlyph?.bounds ?? null;
  const leftSidebearing = bounds ? Math.round(bounds.min.x) : null;
  const rightSidebearing =
    bounds && openedGlyph ? Math.round(openedGlyph.xAdvance - bounds.max.x) : null;
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
          <div className="contents" data-read-only-mutation={!editable || undefined}>
            <EditableSidebarInput
              label="LSB"
              className="text-right"
              value={leftSidebearing}
              onValueChange={editable ? (value) => editor.setLeftSidebearing(value) : undefined}
            />
          </div>
          <div className="px-2">
            <PlaceholderGlyph />
          </div>
          <div className="contents" data-read-only-mutation={!editable || undefined}>
            <EditableSidebarInput
              label="RSB"
              labelPosition="right"
              className="text-left"
              value={rightSidebearing}
              onValueChange={editable ? (value) => editor.setRightSidebearing(value) : undefined}
            />
          </div>
        </div>
        <div className="mt-2" data-read-only-mutation={!editable || undefined}>
          <EditableSidebarInput
            className="text-center"
            value={openedGlyph ? Math.round(openedGlyph.xAdvance) : null}
            onValueChange={editable ? (value) => editor.setXAdvance(value) : undefined}
          />
        </div>
        <div className="font-sans mt-2 text-sm">{glyph.displayName}</div>
      </main>
    </SidebarSection>
  );
};
