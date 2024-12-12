import "./App.css";
import "./index.css";
import { useEffect, useRef, useState } from "react";
import { WebGLRenderer } from "./renderer/WebGLRenderer";
import { invoke } from "@tauri-apps/api/core";

function App() {
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<[number, number] | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WebGLRenderer | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    // Handle high DPI displays
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    // Set the canvas size accounting for device pixel ratio
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    // Set the viewport to match
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    rendererRef.current = new WebGLRenderer(canvasRef.current);

    // Create async function to handle initial line generation
    const initLines = async () => {
      try {
        const vertices = await invoke<number[]>("generate_curve");
        console.log("Initial vertices:", vertices);
        rendererRef.current?.renderTriangles(vertices);
      } catch (error) {
        console.error("Error getting initial lines:", error);
      }
    };

    // Call it
    initLines();

    // rendererRef.current.renderTestTriangle();

    // Initialize renderer

    // // Cleanup

    // canvasRef.current.addEventListener("mousedown", (e: MouseEvent) => {
    //   if (!canvasRef.current) return;

    //   const rect = canvasRef.current.getBoundingClientRect();
    //   const Cx = e.clientX - rect.left;
    //   const Cy = e.clientY - rect.top;

    //   const Gx = (Cx / canvasRef.current.width) * 2 - 1;
    //   const Gy = -((Cy / canvasRef.current.height) * 2) + 1;

    //   console.log(Gx, Gy);

    //   if (!rendererRef.current) return;

    //   if (!isDrawing) {
    //     // First click - set start point
    //     setStartPoint([Gx, Gy]);
    //     setIsDrawing(true);
    //     rendererRef.current.render([Gx, Gy]); // Draw first point
    //   } else {
    //     // Second click - draw line and reset
    //     rendererRef.current.renderLine(startPoint!, [Gx, Gy]);
    //     setIsDrawing(false);
    //     setStartPoint(null);
    //   }
    // });

    return () => {
      rendererRef.current = null;
    };
  }, [isDrawing, startPoint]);

  return (
    <main className="w-screen h-screen flex flex-col items-center justify-center p-10">
      <h1 className="font-blue">Glyph editor</h1>
      <canvas ref={canvasRef} width={800} height={600} className="bg-white" />
    </main>
  );
}

export default App;
