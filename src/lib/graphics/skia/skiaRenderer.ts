import InitCanvasKit, {
  Canvas,
  CanvasKit,
  Paint,
  Path,
  Surface,
} from "canvaskit-wasm";
import { IRenderer } from "../../../types/renderer";
import { SkiaGraphicsContextError } from "./errors";
import { DEFAULT_STYLES, DrawStyle } from "../styles/style";

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

  private getStyledPainter(style: Partial<DrawStyle> = {}): Paint {
    const finalStyle = { ...DEFAULT_STYLES, ...style };

    const p = new this.ctx.canvasKit.Paint();
    p.setStrokeWidth(finalStyle.strokeWidth);
    p.setStyle(this.ctx.canvasKit.PaintStyle.Stroke);

    const [r, g, b] = finalStyle.strokeColour.rgb();
    p.setColor(this.ctx.canvasKit.Color4f(r / 255, g / 255, b / 255, 1.0));

    p.setAntiAlias(finalStyle.antialias ?? true);

    return p;
  }

  drawLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    style?: Partial<DrawStyle>
  ): void {
    const p = this.getStyledPainter(style);
    this.ctx.canvas.drawLine(x0, y0, x1, y1, p);
    this.ctx.surface.flush();
  }

  drawRect(
    x: number,
    y: number,
    width: number,
    height: number,
    style?: Partial<DrawStyle>
  ): void {
    const p = this.getStyledPainter(style);

    const rect = this.ctx.canvasKit.XYWHRect(x, y, width, height);
    this.ctx.canvas.drawRect(rect, p);
    this.ctx.surface.flush();
  }

  drawCircle(
    x: number,
    y: number,
    radius: number,
    style?: Partial<DrawStyle>
  ): void {
    const p = this.getStyledPainter(style);

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

  stroke(): void {
    this.ensurePath().stroke();
  }
}
