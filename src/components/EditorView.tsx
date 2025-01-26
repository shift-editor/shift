import { Editor } from "../lib/editor/Editor";
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
    <>
      <main className="w-screen h-screen flex items-center justify-center flex-col p-10">
        <canvas
          ref={canvasRef}
          className={`w-full h-full border border-black cursor-${activeTool}`}
          onMouseDown={(e) => {
            if (editor.current) {
              editor.current.activeTool().onMouseDown(e);
            }
          }}
          // onMouseUp={(e) => {
          //   if (editor.current) {
          //     editor.current.activeTool().onMouseUp(e);
          //   }
          // }}
          // onMouseMove={(e) => {
          //   if (editor.current) {
          //     editor.current.activeTool().onMouseMove(e);
          //   }
          // }}
        />
      </main>
    </>
  );
};
