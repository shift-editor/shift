import React, { useRef } from "react";

import AppState from "@/store/store";

import { InteractiveScene } from "./InteractiveScene";
import { Metrics } from "./Metrics";
import { StaticScene } from "./StaticScene";

export const EditorView = () => {
  const activeTool = AppState((state) => state.activeTool);
  const editorRef = useRef<HTMLDivElement>(null);

  const editor = AppState.getState().editor;
  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();

    const x = Math.round(e.clientX - rect.left);
    const y = Math.round(e.clientY - rect.top);
    editor.setMousePosition(x, y);
  };

  return (
    <div
      ref={editorRef}
      className={`relative h-full w-full overflow-hidden cursor-${activeTool}`}
      onMouseMove={onMouseMove}
    >
      <StaticScene />
      <InteractiveScene />
      <Metrics />
    </div>
  );
};
