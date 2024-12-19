import { Point } from "./point";
import { Segment, SegmentType } from "./segment";

export class Path {
  #segments: Segment[] = [];

  constructor() {}

  get segments(): Segment[] {
    return this.#segments;
  }

  get numberOfSegments(): number {
    return this.#segments.length;
  }

  isEmpty(): boolean {
    return this.segments.length === 0;
  }

  lastSegment(): Segment {
    return this.#segments[this.numberOfSegments - 1];
  }

  addPoint(point: Point): void {
    if (this.isEmpty()) {
      this.addSegment(new Segment(SegmentType.Line, point));
      return;
    }

    const lastSeg = this.lastSegment();
    if (lastSeg.incompleteSegment()) {
      lastSeg.close(point);
      return;
    }

    this.addSegment(new Segment(SegmentType.Line, point));
    return;
  }

  addSegment(segment: Segment): void {
    this.#segments.push(segment);
  }
}
