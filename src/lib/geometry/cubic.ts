import { Point } from "./point";

export class Cubic {
  private _start: Point;
  private _end: Point;
  private _controlPointOne: Point;
  private _controlPointTwo: Point;

  constructor(
    start: Point,
    end: Point,
    controlPointOne: Point,
    controlPointTwo: Point
  ) {
    this._start = start;
    this._end = end;
    this._controlPointOne = controlPointOne;
    this._controlPointTwo = controlPointTwo;
  }

  // Getters
  get start(): Point {
    return this._start;
  }

  get end(): Point {
    return this._end;
  }

  get controlPointOne(): Point {
    return this._controlPointOne;
  }

  get controlPointTwo(): Point {
    return this._controlPointTwo;
  }

  set start(point: Point) {
    this._start = point;
  }

  set end(point: Point) {
    this._end = point;
  }

  set controlPointOne(point: Point) {
    this._controlPointOne = point;
  }

  set controlPointTwo(point: Point) {
    this._controlPointTwo = point;
  }
}
