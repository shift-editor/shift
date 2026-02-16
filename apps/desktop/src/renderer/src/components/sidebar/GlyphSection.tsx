import { formatCodepointAsUPlus } from "@/lib/utils/unicode";
import { SidebarSection } from "./SidebarSection";
import { EditableSidebarInput } from "./EditableSidebarInput";
import Glyph from "@/assets/sidebar/placeholder-glyph.svg";
import { getEditor } from "@/store/store";
import { useSignalState } from "@/lib/reactive";
import { getGlyphInfo } from "@/store/glyphInfo";

export const GlyphSection = () => {
  const editor = getEditor();
  const glyph = useSignalState(editor.glyph);
  const glyphInfo = getGlyphInfo();
  if (!glyph) return null;

  return (
    <SidebarSection title="Glyph">
      <main className="flex flex-col items-center">
        <div className="flex flex-col items-center gap-0.5 mb-2">
          <div className="font-mono text-sm">{formatCodepointAsUPlus(glyph.unicode)}</div>
        </div>
        <div className="flex justify-center items-center gap-2">
          <EditableSidebarInput label="LSB" className="text-right" value={20} />
          <div className="px-2">
            <Glyph />
          </div>
          <EditableSidebarInput
            label="RSB"
            labelPosition="right"
            className="text-left"
            value={20}
          />
        </div>
        <div className="mt-2">
          <EditableSidebarInput
            className="text-center"
            value={glyph.xAdvance}
            onValueChange={(width) => editor.setXAdvance(width)}
          />
        </div>
        <div className="font-sans mt-2 text-sm"> {glyphInfo.getGlyphName(glyph.unicode)}</div>
      </main>
    </SidebarSection>
  );
};
