import { useEffect } from 'react';

import { invoke } from '@tauri-apps/api/core';

import AppState, { getEditor } from '@/store/store';

import { InteractiveScene } from './InteractiveScene';
import { Metrics } from './Metrics';
import { StaticScene } from './StaticScene';

export const EditorView = () => {
  const activeTool = AppState((state) => state.activeTool);
  const editor = getEditor();

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();

    const pan = editor.getPan();

    const dx = e.deltaX;
    const dy = e.deltaY;

    editor.pan(pan.x - dx, pan.y - dy);
    editor.requestRedraw();
  };

  useEffect(() => {
    const sendGlyph = async () => {
      const glyph = await invoke('get_contours');
      console.log(glyph);
    };

    sendGlyph();
  }, []);

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
      <StaticScene />
      <InteractiveScene />
      <Metrics />
    </div>
  );
};
