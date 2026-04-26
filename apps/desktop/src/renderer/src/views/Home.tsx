import { GlyphGrid } from "@/components/home/GlyphGrid";
import { LeftSidebar } from "@/components/home/LeftSidebar";
import { RightSidebar } from "@/components/editor/RightSidebar";
import { Toolbar } from "@/components/chrome/Toolbar";
import { GlyphCatalogProvider } from "@/context/GlyphCatalogContext";

export const Home = () => (
  <GlyphCatalogProvider>
    <main className="grid h-screen w-full grid-rows-[auto_minmax(0,1fr)]">
      <Toolbar />
      <section className="flex min-h-0 overflow-hidden">
        <LeftSidebar />
        <div className="min-h-0 min-w-0 flex-1">
          <GlyphGrid />
        </div>
        <RightSidebar />
      </section>
    </main>
  </GlyphCatalogProvider>
);
