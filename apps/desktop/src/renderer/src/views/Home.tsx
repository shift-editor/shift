import { GlyphGrid } from "@/components/GlyphGrid";
import { Toolbar } from "@/components/Toolbar";

export const Home = () => {
  return (
    <main className="grid h-full w-full grid-rows-[auto_1fr]">
      <Toolbar />
      <section className="flex h-[100vh] overflow-y-auto">
        <div className="flex-6">
          <GlyphGrid />
        </div>
      </section>
    </main>
  );
};
