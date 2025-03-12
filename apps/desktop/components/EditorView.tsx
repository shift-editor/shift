import { FC, useEffect } from 'react';

import { useLocation } from 'react-router-dom';

import { CanvasContextProvider } from '@/context/CanvasContext';
import AppState, { getEditor } from '@/store/store';

import { InteractiveScene } from './InteractiveScene';
import { Metrics } from './Metrics';
import { StaticScene } from './StaticScene';

interface EditorViewProps {
  glyphId: string | undefined;
}

export const EditorView: FC<EditorViewProps> = ({ glyphId }) => {
  const activeTool = AppState((state) => state.activeTool);
  const editor = getEditor();

  useEffect(() => {
    if (glyphId) {
      console.log('Glyph ID', glyphId);
    }

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
      <Metrics />
    </div>
  );
};
