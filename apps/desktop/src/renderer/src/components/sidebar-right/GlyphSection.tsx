import { formatCodepointAsUPlus } from "@/lib/utils/unicode";
import { SidebarSection } from "./SidebarSection";
import { EditableSidebarInput } from "./EditableSidebarInput";
import Glyph from "@/assets/sidebar-right/placeholder-glyph.svg";
import { getEditor } from "@/store/store";
import { useSignalState } from "@/lib/reactive";
import { getGlyphInfo } from "@/store/glyphInfo";
import { deriveGlyphSidebearings, roundSidebearing } from "@/lib/editor/sidebearings";

export const GlyphSection = () => {
  const editor = getEditor();
  const glyph = useSignalState(editor.glyph);
  const glyphInfo = getGlyphInfo();

  if (!glyph) return null;

  const unicode = formatCodepointAsUPlus(glyph.unicode);
  const sidebearings = deriveGlyphSidebearings(glyph);
  const xAdvance = Math.round(glyph.xAdvance);

  const lsb = roundSidebearing(sidebearings.lsb);
  const rsb = roundSidebearing(sidebearings.rsb);

  const sidebearingsEnabled = lsb !== null && rsb !== null;

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
            <Glyph />
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
            value={xAdvance}
            onValueChange={(width) => editor.setXAdvance(width)}
            disabled={!glyph}
          />
        </div>
        <div className="font-sans mt-2 text-sm">{glyphInfo.getGlyphName(glyph?.unicode ?? 0)}</div>
      </main>
    </SidebarSection>
  );
};
