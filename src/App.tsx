import "./index.css";
import { MouseEventHandler, useEffect, useRef } from "react";
import {
  SkiaGraphicsContext,
  SkiaRenderer,
} from "./lib/graphics/skia/skiaRenderer";
import { PathRenderer } from "./lib/graphics/draw/pathRenderer";
import { Path } from "./lib/geometry/path";
import { Point } from "./lib/geometry/point";
import { SegmentType } from "./lib/geometry/segment";

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<SkiaRenderer | null>(null);
  const pathRenderer = useRef<PathRenderer | null>(null);
  const path = new Path();

  useEffect(() => {
    if (!canvasRef.current) return;
    const initRenderer = async (canvas: HTMLCanvasElement) => {
      try {
        const result = await SkiaGraphicsContext.init(canvas);
        if (!result.success) {
          return;
        }
        rendererRef.current = new SkiaRenderer(result.data);
        pathRenderer.current = new PathRenderer(rendererRef.current);
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
    if (!pathRenderer.current) return;

    const r = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;

    console.log(x, y);

    path.addPoint(new Point(x, y), SegmentType.Bezier);
    pathRenderer.current.render(path);

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
