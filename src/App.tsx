import "./index.css";
import { MouseEventHandler, useEffect, useRef } from "react";
import {
  SkiaGraphicsContext,
  SkiaRenderer,
} from "./lib/graphics/skia/skiaRenderer";
import { Handle, HandleType } from "./lib/graphics/editor/handle";
import { Point } from "./lib/geometry/point";

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<SkiaRenderer | null>(null);
  const handles: Handle[] = [];

  useEffect(() => {
    if (!canvasRef.current) return;
    const initRenderer = async (canvas: HTMLCanvasElement) => {
      try {
        const result = await SkiaGraphicsContext.init(canvas);
        if (!result.success) {
          return;
        }
        rendererRef.current = new SkiaRenderer(result.data);
      } catch (error) {
        console.log(error);
      }
    };

    initRenderer(canvasRef.current);
  }, []);

  const onMouseDown: MouseEventHandler<HTMLCanvasElement> = (
    e: React.MouseEvent<HTMLCanvasElement>
  ) => {
    if (!canvasRef.current) {
      return;
    }
    if (!rendererRef.current) return;

    const r = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;

    console.log(x, y);

    const corner = new Handle(HandleType.CORNER, new Point(x, y));
    handles.push(corner);

    for (const h of handles) {
      h.draw(rendererRef.current);
    }
    rendererRef.current.flush();
  };

  return (
    <main className="w-screen h-screen flex items-center justify-center flex-col p-10">
      <h1>Glyph editor</h1>
      <canvas
        onMouseDown={onMouseDown}
        ref={canvasRef}
        className="w-full h-full border border-black"
      />
    </main>
  );
}

export default App;
