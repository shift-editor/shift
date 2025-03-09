export class SkiaGraphicsContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkiaGraphicsContextError ';
  }
}

export class SkiaRendererError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkiaRendererError ';
  }
}
