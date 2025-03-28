import { useEffect } from 'react';

import { GlyphGrid } from '@/components/GlyphGrid';
import { Toolbar } from '@/components/Toolbar';
import AppState from '@/store/store';

export const Home = () => {
  const setActiveTool = AppState((state) => state.setActiveTool);

  useEffect(() => {
    setActiveTool('disabled');
  }, []);

  return (
    <main className="grid h-full w-full grid-rows-[auto_1fr]">
      <Toolbar />
      <section className="bg-secondary flex h-[90vh] overflow-y-auto">
        <div className="flex-6">
          <GlyphGrid />
        </div>
      </section>
    </main>
  );
};
