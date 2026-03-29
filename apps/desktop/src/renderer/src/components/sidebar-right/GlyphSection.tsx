import { formatCodepointAsUPlus } from "@/lib/utils/unicode";
import { SidebarSection } from "./SidebarSection";
import { EditableSidebarInput } from "./EditableSidebarInput";
import Glyph from "@/assets/sidebar-right/placeholder-glyph.svg";
import { getEditor } from "@/store/store";
import { useSignalState } from "@/lib/reactive";
import { getGlyphInfo } from "@/store/glyphInfo";
import { roundSidebearing } from "@/lib/editor/sidebearings";

export const GlyphSection = () => {
  const editor = getEditor();
  const glyphInfoState = useSignalState(editor.sidebarGlyphInfo);
  const glyphInfo = getGlyphInfo();
  if (!glyphInfoState) return null;
  const sidebearingsEnabled = glyphInfoState.lsb !== null && glyphInfoState.rsb !== null;
  const lsb = glyphInfoState.lsb === null ? null : roundSidebearing(glyphInfoState.lsb);
  const rsb = glyphInfoState.rsb === null ? null : roundSidebearing(glyphInfoState.rsb);

  return (
    <SidebarSection title="Glyph">
      <main className="flex flex-col items-center">
        <div className="flex flex-col items-center gap-0.5 mb-2">
          <div className="font-mono text-sm">{formatCodepointAsUPlus(glyphInfoState.unicode)}</div>
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
            value={glyphInfoState.xAdvance}
            onValueChange={(width) => editor.setXAdvance(width)}
          />
        </div>
        <div className="font-sans mt-2 text-sm">
          {glyphInfo.getGlyphName(glyphInfoState.unicode)}
        </div>
      </main>
    </SidebarSection>
  );
};
