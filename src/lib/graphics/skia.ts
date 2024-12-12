import InitCanvasKit, { Canvas, CanvasKit, Surface } from "canvaskit-wasm";
import { IRenderer } from "../../types/renderer";
import { Point } from "../geometry/point";

export class SkiaGraphicsContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkiaGraphicsContextError ";
  }
}

export class SkiaGraphicsContext {
  private _canvasKit: CanvasKit;
  private _surface: Surface;

  constructor(canvasKit: CanvasKit, surface: Surface) {
    this._canvasKit = canvasKit;
    this._surface = surface;
  }

  public get canvas(): Canvas {
    return this.surface.getCanvas();
  }

  public get surface(): Surface {
    return this._surface;
  }

  public get canvasKit(): CanvasKit {
    return this._canvasKit;
  }

  public static async init(
    canvas: HTMLCanvasElement
  ): Promise<Result<SkiaGraphicsContext, SkiaGraphicsContextError>> {
    try {
      const canvasKit = await InitCanvasKit({
        locateFile: () => `/canvaskit.wasm`,
      });

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
  public ctx: SkiaGraphicsContext;
  private readonly POINT_SIZE = 4;

  public constructor(ctx: SkiaGraphicsContext) {
    this.ctx = ctx;
  }

  DrawPoint(p: Point): void {
    const paint = new this.ctx.canvasKit.Paint();
    paint.setColor(this.ctx.canvasKit.BLACK);
    this.ctx.canvas.drawRect(
      [
        p.x - this.POINT_SIZE / 2,
        p.y - this.POINT_SIZE / 2,
        p.x + this.POINT_SIZE / 2,
        p.y + this.POINT_SIZE / 2,
      ],
      paint
    );

    this.ctx.surface.flush(); // Add this line to flush the drawing
    paint.delete();
  }
}
