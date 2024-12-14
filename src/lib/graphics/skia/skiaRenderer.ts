import InitCanvasKit, {
  Canvas,
  CanvasKit,
  Path,
  Surface,
} from "canvaskit-wasm";
import { IRenderer } from "../../../types/renderer";
import { SkiaGraphicsContextError } from "./errors";

export class SkiaGraphicsContext {
  #canvasKit: CanvasKit;
  #surface: Surface;
  #scale: number;

  constructor(canvasKit: CanvasKit, surface: Surface) {
    this.#canvasKit = canvasKit;
    this.#surface = surface;
    this.#scale = window.devicePixelRatio || 1;

    this.setupTransform();
  }

  private setupTransform(): void {
    const canvas = this.surface.getCanvas();
    canvas.scale(this.#scale, this.#scale); // Scale for device pixel ratio
  }

  public get canvas(): Canvas {
    return this.surface.getCanvas();
  }

  public get surface(): Surface {
    return this.#surface;
  }

  public get canvasKit(): CanvasKit {
    return this.#canvasKit;
  }

  public static async init(
    canvas: HTMLCanvasElement
  ): Promise<Result<SkiaGraphicsContext, SkiaGraphicsContextError>> {
    try {
      const canvasKit = await InitCanvasKit({
        locateFile: () => `/canvaskit.wasm`,
      });

      // Set the canvas size accounting for device pixel ratio
      const dpr = window.devicePixelRatio || 1;
      const displayWidth = canvas.clientWidth;
      const displayHeight = canvas.clientHeight;

      canvas.width = displayWidth * dpr;
      canvas.height = displayHeight * dpr;

      const surface = canvasKit.MakeWebGLCanvasSurface(canvas);
      if (!surface)
        throw new SkiaGraphicsContextError("failed to find surface");

      return {
        data: new SkiaGraphicsContext(canvasKit, surface),
        success: true,
      };
    } catch {
      return {
        success: false,
        error: new SkiaGraphicsContextError("failed to init CanvasKit"),
      };
    }
  }

  public dispose(): void {
    this.surface.delete();
    this.canvas.delete();
  }
}

export class SkiaRenderer implements IRenderer {
  public constructor(private ctx: SkiaGraphicsContext) {}

  drawLine(x0: number, y0: number, x1: number, y1: number): void {
    const p = new this.ctx.canvasKit.Paint();
    p.setStrokeWidth(1);
    p.setStyle(this.ctx.canvasKit.PaintStyle.Stroke);
    p.setColor(this.ctx.canvasKit.BLACK);
    p.setAntiAlias(true);

    this.ctx.canvas.drawLine(x0, y0, x1, y1, p);
  }

  drawRect(x1: number, y1: number, x2: number, y2: number): void {
    const p = new this.ctx.canvasKit.Paint();
    p.setStrokeWidth(1);
    p.setStyle(this.ctx.canvasKit.PaintStyle.Stroke);
    p.setColor(this.ctx.canvasKit.BLACK);

    this.ctx.canvas.drawRect([x1, y1, x2, y2], p);
    this.ctx.surface.flush();
  }

  drawCircle(x: number, y: number, radius: number): void {
    const p = new this.ctx.canvasKit.Paint();
    p.setStrokeWidth(1);
    p.setStyle(this.ctx.canvasKit.PaintStyle.Stroke);
    p.setColor(this.ctx.canvasKit.BLACK);
    // Enable anti-aliasing
    p.setAntiAlias(true);

    this.ctx.canvas.drawCircle(x, y, radius, p);
    this.ctx.surface.flush();
  }

  #path: Path | null = null;

  beginPath(): void {
    this.#path = new this.ctx.canvasKit.Path();
  }

  private ensurePath(): Path {
    if (!this.#path) {
      console.warn(
        "Path operation called without beginPath(), creating new path"
      );
      this.beginPath();
    }
    return this.#path!;
  }

  moveTo(x: number, y: number): void {
    this.ensurePath().moveTo(x, y);
  }

  lineTo(x: number, y: number): void {
    this.ensurePath().lineTo(x, y);
  }

  close(): void {
    this.ensurePath().close();
  }
}
