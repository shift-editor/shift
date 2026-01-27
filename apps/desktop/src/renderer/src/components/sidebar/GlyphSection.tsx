import { Input } from "@shift/ui";
import { SidebarSection } from "./SidebarSection";
import Glyph from "@/assets/sidebar/placeholder-glyph.svg";

export const GlyphSection = () => {
  return (
    <SidebarSection title="Glyph">
      <div className="flex justify-center items-center gap-2">
        <span className="text-ui text-muted">20</span>
        <Glyph />
        <span className="text-ui text-muted">20</span>
      </div>
      <Input className="text-center" value="600" />
      <Input
        className="text-center bg-transparent"
        value="A"
        onChange={(e) => {
          console.log(e.target.value);
        }}
      />
    </SidebarSection>
  );
};
