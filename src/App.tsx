import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import "./App.css";

interface Vector2F {
  x: number;
  y: number;
}

type Command =
  | { MoveTo: Vector2F }
  | { LineTo: Vector2F }
  | { QuadTo: [Vector2F, Vector2F] }
  | { CubeTo: [Vector2F, Vector2F] }
  | "Close";

function App() {
  const [commands, setCommands] = useState<Command[]>([]);

  const getOutline = async () => {
    const res = await invoke<Command[]>("get_family_name", { name: "Arial" });

    return res;
  };

  const canvasRef = useRef<HTMLCanvasElement>(null);

  const drawGlyph = (commands: Command[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Find bounds
    let minX = Infinity,
      minY = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity;

    commands.forEach((cmd) => {
      if (cmd === "Close") return;
      const points =
        "MoveTo" in cmd
          ? [cmd.MoveTo]
          : "LineTo" in cmd
          ? [cmd.LineTo]
          : "QuadTo" in cmd
          ? cmd.QuadTo
          : [];

      points.forEach((p) => {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      });
    });

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Set up canvas
    ctx.beginPath();
    ctx.strokeStyle = "black";
    ctx.lineWidth = 2; // Make lines more visible

    // Calculate scale and position
    const padding = 100;
    const scale = Math.min(
      (canvas.width - padding * 2) / (maxX - minX),
      (canvas.height - padding * 2) / (maxY - minY)
    );

    // Center the glyph
    ctx.save();
    ctx.translate(
      (canvas.width - (maxX - minX) * scale) / 2 - minX * scale,
      (canvas.height + (maxY - minY) * scale) / 2 - minY * scale
    );
    ctx.scale(scale, -scale); // Flip Y axis to match font coordinates;

    commands.forEach((cmd: Command) => {
      if (cmd === "Close") {
        ctx.closePath();
      } else if ("MoveTo" in cmd) {
        ctx.moveTo(cmd.MoveTo.x, cmd.MoveTo.y);
      } else if ("LineTo" in cmd) {
        ctx.lineTo(cmd.LineTo.x, cmd.LineTo.y);
      } else if ("QuadTo" in cmd) {
        const [ctrl, end] = cmd.QuadTo;
        ctx.quadraticCurveTo(ctrl.x, ctrl.y, end.x, end.y);
      }
    });
    ctx.stroke();
  };

  useEffect(() => {
    const getData = async () => {
      try {
        const commands = await invoke<Command[]>("get_family_name", {
          name: "Arial",
        });
        drawGlyph(commands);
      } catch (e) {
        console.error("Error:", e);
      }
    };
    getData();
  }, []);

  return (
    <main className="container">
      <h1>Glyph editor</h1>
      <canvas ref={canvasRef} width={500} height={500} />
    </main>
  );
}

export default App;
