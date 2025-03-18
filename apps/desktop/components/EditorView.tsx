import { FC, useEffect, useState } from 'react';

import { Glyph, Metrics } from '@shift/shared';
import { invoke } from '@tauri-apps/api/core';

import { CanvasContextProvider } from '@/context/CanvasContext';
import AppState, { getEditor } from '@/store/store';

import { InteractiveScene } from './InteractiveScene';
import { Metrics as MetricsComponent } from './Metrics';
import { StaticScene } from './StaticScene';

interface EditorViewProps {
  glyphId: string | undefined;
}

export const EditorView: FC<EditorViewProps> = ({ glyphId }) => {
  const activeTool = AppState((state) => state.activeTool);
  const editor = getEditor();

  useEffect(() => {
    const fetchFontData = async () => {
      const glyph = await invoke<Glyph>('get_glyph', { char: 'C' });
      const metrics = await invoke<Metrics>('get_font_metrics');
      const guides = {
        ascender: { y: metrics.ascender },
        capHeight: { y: metrics.capHeight },
        xHeight: { y: metrics.xHeight },
        descender: { y: metrics.descender },
        baseline: { y: 0 },
        xAdvance: glyph.x_advance,
      };

      editor.constructGuidesPath(guides);
      editor.setViewportUpm(metrics.unitsPerEm);
    };

    fetchFontData();

    editor.activeTool().setReady();

    return () => {
      editor.activeTool().setIdle();
    };
  }, [glyphId]);

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();

    const pan = editor.getPan();

    const dx = e.deltaX;
    const dy = e.deltaY;

    editor.pan(pan.x - dx, pan.y - dy);
    editor.requestRedraw();
  };

  return (
    <div
      className={`relative z-20 h-full w-full overflow-hidden cursor-${activeTool}`}
      onWheel={onWheel}
      onMouseMove={(e) => {
        const position = editor.getMousePosition(e.clientX, e.clientY);
        const { x, y } = editor.projectScreenToUpm(position.x, position.y);
        editor.setUpmMousePosition(x, y);
      }}
    >
      <CanvasContextProvider>
        <StaticScene />
        <InteractiveScene />
      </CanvasContextProvider>
      <MetricsComponent />
    </div>
  );
};
