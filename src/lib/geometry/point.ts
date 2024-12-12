export class Point {
  private _x: number;
  private _y: number;

  constructor(x: number, y: number) {
    this._x = x;
    this._y = y;
  }

  public static create(x: number, y: number): Point {
    return new Point(x, y);
  }

  public get x() {
    return this._x;
  }

  public get y() {
    return this._y;
  }

  public set set_x(x: number) {
    this._x = x;
  }

  public set set_y(y: number) {
    this._y = y;
  }
}
