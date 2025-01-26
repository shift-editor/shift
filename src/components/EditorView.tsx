import { Editor } from "../lib/editor/editor";
import { CanvasKitRenderer } from "../lib/graphics/backends/CanvasKitRenderer";
import AppState from "../store/store";

export interface EditorViewProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  ctx: React.RefObject<CanvasKitRenderer | null>;
  editor: React.RefObject<Editor | null>;
}

export const EditorView = ({ canvasRef, ctx, editor }: EditorViewProps) => {
  const activeTool = AppState((state) => state.activeTool);

  return (
    <div className="w-full h-full p-4">
      <canvas
        ref={canvasRef}
        className={`w-full h-full border border-black cursor-${activeTool}`}
        onMouseDown={(e) => {
          if (editor.current) {
            editor.current.activeTool().onMouseDown(e);
          }
        }}
      />
    </div>
  );
};
