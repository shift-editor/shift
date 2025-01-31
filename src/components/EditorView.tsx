import { IGraphicContext } from "../types/graphics";
import { InteractiveScene } from "./InteractiveScene";
import { StaticScene } from "./StaticScene";

export interface EditorViewProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  ctx: React.RefObject<IGraphicContext | null>;
}

export const EditorView = ({ canvasRef, ctx }: EditorViewProps) => {
  return (
    <div className="w-full h-full overflow-hidden relative">
      <StaticScene />
      <InteractiveScene canvasRef={canvasRef} ctx={ctx} />
    </div>
  );
};
