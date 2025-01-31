import AppState from "../store/store";
import { IGraphicContext } from "../types/graphics";

export interface EditorViewProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  ctx: React.RefObject<IGraphicContext | null>;
}

export const EditorView = ({ canvasRef, ctx }: EditorViewProps) => {
  const activeTool = AppState((state) => state.activeTool);

  return (
    <div className="w-full h-full overflow-hidden p-8">
      <canvas
        ref={canvasRef}
        className={`w-full h-full border border-black cursor-${activeTool}`}
        style={{
          imageRendering: "pixelated",
        }}
        onMouseDown={() => {
          if (!ctx.current) return;
          const renderer = ctx.current.getContext();
          renderer.drawCircle(0, 0, 50);
          renderer.flush();
        }}
      />
    </div>
  );
};
