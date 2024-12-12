export type Point = {
  x: number;
  y: number;
};

export interface Vector {
  start: Point;
  end: Point;
}

export interface Tool {
  name: string;
  icon: string;

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void;
  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void;
  onMouseUp(e: React.MouseEvent<HTMLCanvasElement>): void;
}

export abstract class BaseTool implements Tool {
  name: string;
  icon: string;

  constructor(name: string, icon: string) {
    this.name = name;
    this.icon = icon;
  }

  abstract onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void;
  abstract onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void;
  abstract onMouseUp(e: React.MouseEvent<HTMLCanvasElement>): void;
}
