import { Point } from "./point";
import { Segment, SegmentType } from "./segment";

export class Path {
  #segments: Segment[] = [];
  #closed: boolean = false;

  constructor() {}

  get segments(): Segment[] {
    return this.#segments;
  }

  get numberOfSegments(): number {
    return this.#segments.length;
  }

  get isClosed(): boolean {
    return this.#closed;
  }

  close(): void {
    if (this.numberOfSegments < 2) return;
    this.#closed = true;
  }

  isEmpty(): boolean {
    return this.segments.length === 0;
  }

  lastSegment(): Segment {
    return this.#segments[this.numberOfSegments - 1];
  }

  addSegment(segment: Segment): void {
    this.#segments.push(segment);
  }

  addPoint(point: Point, type: SegmentType): void {
    if (this.isEmpty()) {
      this.addSegment(new Segment(type, point));
      return;
    }

    const lastSeg = this.lastSegment();
    if (lastSeg.incompleteSegment()) {
      lastSeg.close(point);
      return;
    }

    this.addSegment(new Segment(type, lastSeg.startPoint));
    this.lastSegment().close(point);
    return;
  }
}
