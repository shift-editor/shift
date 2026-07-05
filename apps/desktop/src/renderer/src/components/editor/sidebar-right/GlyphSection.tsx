import { formatCodepointAsUPlus } from "@/lib/utils/unicode";
import { SidebarSection } from "./SidebarSection";
import { EditableSidebarInput } from "./EditableSidebarInput";
import PlaceholderGlyph from "@/assets/sidebar-right/placeholder-glyph.svg";
import { useEditor } from "@/workspace/WorkspaceContext";
import { getGlyphInfo } from "@/workspace/glyphInfo";
import { useGlyphSidebearings } from "@/hooks/useGlyphSidebearings";
import { useGlyphXAdvance } from "@/hooks/useGlyphXAdvance";

export const GlyphSection = () => {
  const editor = useEditor();
  const sidebearings = useGlyphSidebearings();
  const xAdvance = useGlyphXAdvance();
  const glyphInfo = getGlyphInfo();

  const unicodeValue = 0;
  const unicode = formatCodepointAsUPlus(unicodeValue);
  const lsb =
    sidebearings.sidebearings.lsb === null ? null : Math.round(sidebearings.sidebearings.lsb);
  const rsb =
    sidebearings.sidebearings.rsb === null ? null : Math.round(sidebearings.sidebearings.rsb);
  const sidebearingsEnabled = sidebearings.hasLayer && lsb !== null && rsb !== null;

  return (
    <SidebarSection title="Glyph">
      <main className="flex flex-col items-center">
        <div className="flex flex-col items-center gap-0.5 mb-2">
          <div className="font-mono text-sm">{unicode}</div>
        </div>
        <div className="flex justify-center items-center gap-2">
          <EditableSidebarInput
            label="LSB"
            className="text-right"
            value={lsb}
            disabled={!sidebearingsEnabled}
            onValueChange={(next) => editor.setLeftSidebearing(next)}
          />
          <div className="px-2">
            <PlaceholderGlyph />
          </div>
          <EditableSidebarInput
            label="RSB"
            labelPosition="right"
            className="text-left"
            value={rsb}
            disabled={!sidebearingsEnabled}
            onValueChange={(next) => editor.setRightSidebearing(next)}
          />
        </div>
        <div className="mt-2">
          <EditableSidebarInput
            className="text-center"
            value={Math.round(xAdvance.xAdvance)}
            disabled={!xAdvance.hasLayer}
            onValueChange={(width) => editor.setXAdvance(width)}
          />
        </div>
        <div className="font-sans mt-2 text-sm">{glyphInfo.getGlyphName(unicodeValue)}</div>
      </main>
    </SidebarSection>
  );
};
