import { GlyphGrid } from '@/components/GlyphGrid';
import { SidePane } from '@/components/SidePane';
import { Toolbar } from '@/components/Toolbar';

export const Home = () => {
  return (
    <main className="grid h-full w-full grid-rows-[auto_1fr]">
      <Toolbar />
      <section className="flex">
        <div className="flex-6">
          <GlyphGrid />
        </div>
        <div className="flex-1">
          <SidePane />
        </div>
      </section>
    </main>
  );
};
