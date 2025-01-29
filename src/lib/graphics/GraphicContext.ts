export interface ISurface {
  width(): number;
  height(): number;
  dispose(): void;
}

export interface IGraphicContext<TSurface extends ISurface> {
  surface: TSurface;

  createSurface(canvas: HTMLCanvasElement): void;
  recreateSurface(canvas: HTMLCanvasElement): void;
}
