import { describe, it, expect } from 'vitest';

import { Segment } from './Segment';
import type { LineSegment, QuadSegment, CubicSegment, Segment as SegmentType } from '@/types/segments';

const makeSegmentPoint = (id: string, x: number, y: number, pointType: 'onCurve' | 'offCurve' = 'onCurve') => ({
  id,
  x,
  y,
  pointType,
  smooth: false,
});

describe('Segment', () => {
  describe('id', () => {
    it('should create id for line segment', () => {
      const segment: LineSegment = {
        type: 'line',
        points: {
          anchor1: makeSegmentPoint('p1', 0, 0),
          anchor2: makeSegmentPoint('p2', 100, 100),
        },
      };
      expect(Segment.id(segment)).toBe('p1:p2');
    });

    it('should create id for quad segment', () => {
      const segment: QuadSegment = {
        type: 'quad',
        points: {
          anchor1: makeSegmentPoint('p1', 0, 0),
          control: makeSegmentPoint('c1', 50, 100, 'offCurve'),
          anchor2: makeSegmentPoint('p2', 100, 0),
        },
      };
      expect(Segment.id(segment)).toBe('p1:p2');
    });

    it('should create id for cubic segment', () => {
      const segment: CubicSegment = {
        type: 'cubic',
        points: {
          anchor1: makeSegmentPoint('p1', 0, 0),
          control1: makeSegmentPoint('c1', 25, 100, 'offCurve'),
          control2: makeSegmentPoint('c2', 75, 100, 'offCurve'),
          anchor2: makeSegmentPoint('p2', 100, 0),
        },
      };
      expect(Segment.id(segment)).toBe('p1:p2');
    });
  });

  describe('toCurve', () => {
    it('should convert line segment to line curve', () => {
      const segment: LineSegment = {
        type: 'line',
        points: {
          anchor1: makeSegmentPoint('p1', 0, 0),
          anchor2: makeSegmentPoint('p2', 100, 100),
        },
      };
      const curve = Segment.toCurve(segment);
      expect(curve.type).toBe('line');
      expect(curve.p0).toEqual({ x: 0, y: 0, id: 'p1', pointType: 'onCurve', smooth: false });
      expect(curve.p1).toEqual({ x: 100, y: 100, id: 'p2', pointType: 'onCurve', smooth: false });
    });

    it('should convert quad segment to quadratic curve', () => {
      const segment: QuadSegment = {
        type: 'quad',
        points: {
          anchor1: makeSegmentPoint('p1', 0, 0),
          control: makeSegmentPoint('c1', 50, 100, 'offCurve'),
          anchor2: makeSegmentPoint('p2', 100, 0),
        },
      };
      const curve = Segment.toCurve(segment);
      expect(curve.type).toBe('quadratic');
    });

    it('should convert cubic segment to cubic curve', () => {
      const segment: CubicSegment = {
        type: 'cubic',
        points: {
          anchor1: makeSegmentPoint('p1', 0, 0),
          control1: makeSegmentPoint('c1', 25, 100, 'offCurve'),
          control2: makeSegmentPoint('c2', 75, 100, 'offCurve'),
          anchor2: makeSegmentPoint('p2', 100, 0),
        },
      };
      const curve = Segment.toCurve(segment);
      expect(curve.type).toBe('cubic');
    });
  });

  describe('bounds', () => {
    it('should compute bounds for line segment', () => {
      const segment: LineSegment = {
        type: 'line',
        points: {
          anchor1: makeSegmentPoint('p1', 10, 20),
          anchor2: makeSegmentPoint('p2', 100, 80),
        },
      };
      const bounds = Segment.bounds(segment);
      expect(bounds.min.x).toBe(10);
      expect(bounds.min.y).toBe(20);
      expect(bounds.max.x).toBe(100);
      expect(bounds.max.y).toBe(80);
    });

    it('should compute bounds for cubic segment', () => {
      const segment: CubicSegment = {
        type: 'cubic',
        points: {
          anchor1: makeSegmentPoint('p1', 0, 0),
          control1: makeSegmentPoint('c1', 0, 100, 'offCurve'),
          control2: makeSegmentPoint('c2', 100, 100, 'offCurve'),
          anchor2: makeSegmentPoint('p2', 100, 0),
        },
      };
      const bounds = Segment.bounds(segment);
      expect(bounds.min.x).toBeLessThanOrEqual(0);
      expect(bounds.min.y).toBeLessThanOrEqual(0);
      expect(bounds.max.x).toBeGreaterThanOrEqual(100);
      expect(bounds.max.y).toBeGreaterThan(0);
    });
  });

  describe('hitTest', () => {
    it('should hit test a line segment', () => {
      const segment: LineSegment = {
        type: 'line',
        points: {
          anchor1: makeSegmentPoint('p1', 0, 0),
          anchor2: makeSegmentPoint('p2', 100, 0),
        },
      };

      const hitOnLine = Segment.hitTest(segment, { x: 50, y: 0 }, 5);
      expect(hitOnLine).not.toBeNull();
      expect(hitOnLine!.distance).toBeLessThan(5);
      expect(hitOnLine!.segmentId).toBe('p1:p2');

      const hitNearLine = Segment.hitTest(segment, { x: 50, y: 3 }, 5);
      expect(hitNearLine).not.toBeNull();

      const missLine = Segment.hitTest(segment, { x: 50, y: 10 }, 5);
      expect(missLine).toBeNull();
    });

    it('should return closest point on hit', () => {
      const segment: LineSegment = {
        type: 'line',
        points: {
          anchor1: makeSegmentPoint('p1', 0, 0),
          anchor2: makeSegmentPoint('p2', 100, 0),
        },
      };

      const hit = Segment.hitTest(segment, { x: 50, y: 2 }, 5);
      expect(hit).not.toBeNull();
      expect(hit!.point.x).toBeCloseTo(50, 1);
      expect(hit!.point.y).toBeCloseTo(0, 1);
      expect(hit!.t).toBeCloseTo(0.5, 1);
    });

    it('should hit test a cubic segment', () => {
      const segment: CubicSegment = {
        type: 'cubic',
        points: {
          anchor1: makeSegmentPoint('p1', 0, 0),
          control1: makeSegmentPoint('c1', 25, 50, 'offCurve'),
          control2: makeSegmentPoint('c2', 75, 50, 'offCurve'),
          anchor2: makeSegmentPoint('p2', 100, 0),
        },
      };

      const hitNearStart = Segment.hitTest(segment, { x: 0, y: 0 }, 5);
      expect(hitNearStart).not.toBeNull();

      const missSegment = Segment.hitTest(segment, { x: 50, y: 100 }, 5);
      expect(missSegment).toBeNull();
    });

    it('should early reject based on bounds', () => {
      const segment: LineSegment = {
        type: 'line',
        points: {
          anchor1: makeSegmentPoint('p1', 0, 0),
          anchor2: makeSegmentPoint('p2', 100, 0),
        },
      };

      const farAway = Segment.hitTest(segment, { x: 500, y: 500 }, 5);
      expect(farAway).toBeNull();
    });
  });

  describe('hitTestMultiple', () => {
    it('should return the closest hit from multiple segments', () => {
      const segments: SegmentType[] = [
        {
          type: 'line',
          points: {
            anchor1: makeSegmentPoint('p1', 0, 0),
            anchor2: makeSegmentPoint('p2', 100, 0),
          },
        },
        {
          type: 'line',
          points: {
            anchor1: makeSegmentPoint('p3', 0, 50),
            anchor2: makeSegmentPoint('p4', 100, 50),
          },
        },
      ];

      const hit = Segment.hitTestMultiple(segments, { x: 50, y: 1 }, 10);
      expect(hit).not.toBeNull();
      expect(hit!.segmentId).toBe('p1:p2');
    });

    it('should return null if no segments hit', () => {
      const segments: SegmentType[] = [
        {
          type: 'line',
          points: {
            anchor1: makeSegmentPoint('p1', 0, 0),
            anchor2: makeSegmentPoint('p2', 100, 0),
          },
        },
      ];

      const hit = Segment.hitTestMultiple(segments, { x: 50, y: 100 }, 5);
      expect(hit).toBeNull();
    });

    it('should return null for empty segments array', () => {
      const hit = Segment.hitTestMultiple([], { x: 50, y: 0 }, 5);
      expect(hit).toBeNull();
    });
  });

  describe('type guards', () => {
    it('should identify line segments', () => {
      const segment: LineSegment = {
        type: 'line',
        points: {
          anchor1: makeSegmentPoint('p1', 0, 0),
          anchor2: makeSegmentPoint('p2', 100, 0),
        },
      };
      expect(Segment.isLine(segment)).toBe(true);
      expect(Segment.isQuad(segment)).toBe(false);
      expect(Segment.isCubic(segment)).toBe(false);
    });

    it('should identify quad segments', () => {
      const segment: QuadSegment = {
        type: 'quad',
        points: {
          anchor1: makeSegmentPoint('p1', 0, 0),
          control: makeSegmentPoint('c1', 50, 100, 'offCurve'),
          anchor2: makeSegmentPoint('p2', 100, 0),
        },
      };
      expect(Segment.isLine(segment)).toBe(false);
      expect(Segment.isQuad(segment)).toBe(true);
      expect(Segment.isCubic(segment)).toBe(false);
    });

    it('should identify cubic segments', () => {
      const segment: CubicSegment = {
        type: 'cubic',
        points: {
          anchor1: makeSegmentPoint('p1', 0, 0),
          control1: makeSegmentPoint('c1', 25, 100, 'offCurve'),
          control2: makeSegmentPoint('c2', 75, 100, 'offCurve'),
          anchor2: makeSegmentPoint('p2', 100, 0),
        },
      };
      expect(Segment.isLine(segment)).toBe(false);
      expect(Segment.isQuad(segment)).toBe(false);
      expect(Segment.isCubic(segment)).toBe(true);
    });
  });
});
