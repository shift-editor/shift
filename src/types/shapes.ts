export class Line {
  start: { x: number; y: number };
  end: { x: number; y: number };

  constructor() {
    this.start = { x: 0, y: 0 };
    this.end = { x: 0, y: 0 };
  }

  draw(): void {}
}
