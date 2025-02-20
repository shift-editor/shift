import { Point } from "./point";

export class Cubic {
  #start: Point;
  #end: Point;
  #controlPointOne: Point;
  #controlPointTwo: Point;

  constructor(
    start: Point,
    end: Point,
    controlPointOne: Point,
    controlPointTwo: Point,
  ) {
    this.#start = start;
    this.#end = end;
    this.#controlPointOne = controlPointOne;
    this.#controlPointTwo = controlPointTwo;
  }

  get start(): Point {
    return this.#start;
  }

  get end(): Point {
    return this.#end;
  }

  get controlPointOne(): Point {
    return this.#controlPointOne;
  }

  get controlPointTwo(): Point {
    return this.#controlPointTwo;
  }

  set start(point: Point) {
    this.#start = point;
  }

  set end(point: Point) {
    this.#end = point;
  }

  set controlPointOne(point: Point) {
    this.#controlPointOne = point;
  }

  set controlPointTwo(point: Point) {
    this.#controlPointTwo = point;
  }
}
