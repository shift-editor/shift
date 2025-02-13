import React, { useRef } from "react";

import AppState, { getEditor } from "@/store/store";

import { InteractiveScene } from "./InteractiveScene";
import { Metrics } from "./Metrics";
import { StaticScene } from "./StaticScene";

export const EditorView = () => {
  const activeTool = AppState((state) => state.activeTool);
  const editorRef = useRef<HTMLDivElement>(null);

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {};

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
