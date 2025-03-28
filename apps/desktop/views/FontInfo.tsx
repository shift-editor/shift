import { useEffect, useState } from 'react';

import { Metrics } from '@shift/shared';
import { invoke } from '@tauri-apps/api/core';

import { Toolbar } from '@/components/Toolbar';

export const FontInfo = () => {
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    const fetchFontMetrics = async () => {
      const metrics = await invoke<Metrics>('get_font_metrics');
      setMetrics(metrics);
    };

    fetchFontMetrics();
  }, []);

  return (
    <>
      <Toolbar />
      <main className="text-light flex h-screen w-screen flex-col items-center justify-center text-white">
        <h1>Font Info</h1>
        <div>
          <p>Units per em: {metrics?.unitsPerEm}</p>
          <p>Ascender: {metrics?.ascender}</p>
          <p>Descender: {metrics?.descender}</p>
          <p>Cap height: {metrics?.capHeight}</p>
        </div>
      </main>
    </>
  );
};
