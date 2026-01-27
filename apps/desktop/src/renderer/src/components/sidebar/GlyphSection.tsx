import { Input } from "@shift/ui";
import { SidebarSection } from "./SidebarSection";
import Glyph from "@/assets/sidebar/placeholder-glyph.svg";

export const GlyphSection = () => {
  return (
    <SidebarSection title="Glyph">
      <div className="flex justify-center items-center gap-2">
        <Input className="text-right bg-transparent" value="20" />
        <div>
          <Glyph />
        </div>
        <Input className="text-left bg-transparent" value="20" />
      </div>
      <Input className="text-center bg-transparent" value="600" />
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
