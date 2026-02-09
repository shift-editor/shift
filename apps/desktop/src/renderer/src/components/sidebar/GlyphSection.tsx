import { SidebarSection } from "./SidebarSection";
import { EditableSidebarInput } from "./EditableSidebarInput";
import Glyph from "@/assets/sidebar/placeholder-glyph.svg";
import { getEditor } from "@/store/store";
import { useSignalState } from "@/lib/reactive";

export const GlyphSection = () => {
  const editor = getEditor();
  const glyph = useSignalState(editor.glyph);
  if (!glyph) return null;

  return (
    <SidebarSection title="Glyph">
      <div className="flex justify-center items-center gap-2">
        <EditableSidebarInput className="text-right bg-transparent" value={20} />
        <div>
          <Glyph />
        </div>
        <EditableSidebarInput className="text-left bg-transparent" value={20} />
      </div>
      <EditableSidebarInput
        className="text-center bg-transparent"
        value={glyph.xAdvance}
        onValueChange={(width) => editor.setXAdvance(width)}
      />
    </SidebarSection>
  );
};
