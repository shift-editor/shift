import { useContext } from "react";

import { CanvasContext } from "@/context/CanvasContext";
import { getEditor } from "@/store/store";

export const InteractiveScene = () => {
  const { interactiveCanvasRef } = useContext(CanvasContext);
  const editor = getEditor();

  return (
    <canvas
      id="interactive-canvas"
      ref={interactiveCanvasRef}
      className="absolute inset-0 z-20 h-full w-full"
      onMouseDown={(e) => {
        editor.getActiveTool().onMouseDown(e);
      }}
      onMouseUp={(e) => {
        editor.getActiveTool().onMouseUp(e);
      }}
      onMouseMove={(e) => {
        editor.getActiveTool().onMouseMove(e);
      }}
      onDoubleClick={(e) => {
        const tool = editor.getActiveTool();
        if (!tool.onDoubleClick) return;
        tool.onDoubleClick(e);
      }}
    />
  );
};
