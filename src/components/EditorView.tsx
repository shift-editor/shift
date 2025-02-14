import React, { useRef } from "react";

import AppState, { getEditor } from "@/store/store";

import { InteractiveScene } from "./InteractiveScene";
import { Metrics } from "./Metrics";
import { StaticScene } from "./StaticScene";

export const EditorView = () => {
  const activeTool = AppState((state) => state.activeTool);
  const editor = getEditor();

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();

    const pan = editor.getPan();

    const dx = (e.deltaX * 1.25) / editor.zoom();
    const dy = (e.deltaY * 1.25) / editor.zoom();

    editor.pan(pan.x - dx, pan.y - dy);
    editor.requestRedraw();
  };

  return (
    <div
      className={`relative h-full w-full overflow-hidden cursor-${activeTool}`}
      onWheel={onWheel}
      onMouseMove={(e) => {
        const mousePos = editor.upmMousePosition(e.clientX, e.clientY);
        console.log(mousePos);
      }}
    >
      <StaticScene />
      <InteractiveScene />
      <Metrics />
    </div>
  );
};
