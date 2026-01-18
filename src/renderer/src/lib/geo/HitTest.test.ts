import { describe, it, expect } from 'vitest';
import { HitTest } from './HitTest';
import { Segment } from './Segment';
import type { Rect2D } from '@/types/math';

describe('HitTest', () => {
  describe('point', () => {
    it('returns true when within radius', () => {
      expect(HitTest.point({ x: 0, y: 0 }, { x: 3, y: 4 }, 6)).toBe(true);
    });

    it('returns false when outside radius', () => {
      expect(HitTest.point({ x: 0, y: 0 }, { x: 3, y: 4 }, 4)).toBe(false);
    });

    it('handles exact radius boundary', () => {
      // Distance is exactly 5, radius is 5 - should be false (strict inequality)
      expect(HitTest.point({ x: 0, y: 0 }, { x: 3, y: 4 }, 5)).toBe(false);
      expect(HitTest.point({ x: 0, y: 0 }, { x: 3, y: 4 }, 5.01)).toBe(true);
    });
  });

  describe('lineSegment', () => {
    it('detects hit on line', () => {
      const result = HitTest.lineSegment(
        { x: 5, y: 2 },
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        5
      );
      expect(result.hit).toBe(true);
      expect(result.distance).toBeCloseTo(2);
      expect(result.closestPoint).toEqual({ x: 5, y: 0 });
      expect(result.t).toBeCloseTo(0.5);
    });

    it('detects miss on line', () => {
      const result = HitTest.lineSegment(
        { x: 5, y: 10 },
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        5
      );
      expect(result.hit).toBe(false);
      expect(result.distance).toBeCloseTo(10);
    });

    it('handles endpoint proximity', () => {
      const result = HitTest.lineSegment(
        { x: -2, y: 0 },
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        3
      );
      expect(result.hit).toBe(true);
      expect(result.closestPoint).toEqual({ x: 0, y: 0 });
      expect(result.t).toBe(0);
    });
  });

  describe('segment', () => {
    it('works with line segments', () => {
      const line = Segment.line({ x: 0, y: 0 }, { x: 10, y: 0 });
      const result = HitTest.segment({ x: 5, y: 2 }, line, 5);
      expect(result.hit).toBe(true);
    });

    it('works with cubic segments', () => {
      const cubic = Segment.cubic(
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: 10, y: 10 },
        { x: 10, y: 0 }
      );
      const result = HitTest.segment({ x: 5, y: 8 }, cubic, 3);
      expect(result.hit).toBe(true);
    });
  });

  describe('rectContains', () => {
    const rect: Rect2D = {
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      left: 10,
      top: 20,
      right: 110,
      bottom: 70,
    };

    it('returns true for point inside', () => {
      expect(HitTest.rectContains({ x: 50, y: 40 }, rect)).toBe(true);
    });

    it('returns true for point on edge', () => {
      expect(HitTest.rectContains({ x: 10, y: 40 }, rect)).toBe(true);
      expect(HitTest.rectContains({ x: 110, y: 70 }, rect)).toBe(true);
    });

    it('returns false for point outside', () => {
      expect(HitTest.rectContains({ x: 5, y: 40 }, rect)).toBe(false);
      expect(HitTest.rectContains({ x: 50, y: 80 }, rect)).toBe(false);
    });
  });

  describe('rectBoundary', () => {
    const rect: Rect2D = {
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      left: 0,
      top: 0,
      right: 100,
      bottom: 50,
    };

    it('detects hit near boundary', () => {
      const result = HitTest.rectBoundary({ x: 50, y: -3 }, rect, 5);
      expect(result.hit).toBe(true);
      expect(result.closestPoint.y).toBeCloseTo(0);
    });

    it('detects miss far from boundary', () => {
      const result = HitTest.rectBoundary({ x: 50, y: -10 }, rect, 5);
      expect(result.hit).toBe(false);
    });
  });

  describe('collection', () => {
    const targets = [
      HitTest.pointTarget({ x: 10, y: 10 }, 'p1', 10),
      HitTest.pointTarget({ x: 20, y: 20 }, 'p2', 5),
      HitTest.segmentTarget(
        Segment.line({ x: 0, y: 0 }, { x: 100, y: 0 }),
        's1',
        1
      ),
    ];

    it('finds closest target within radius', () => {
      const result = HitTest.collection({ x: 11, y: 10 }, targets, { radius: 5 });
      expect(result).not.toBeNull();
      expect(result?.target?.id).toBe('p1');
    });

    it('returns null when nothing in radius', () => {
      const result = HitTest.collection({ x: 50, y: 50 }, targets, { radius: 5 });
      expect(result).toBeNull();
    });

    it('respects priority for equidistant targets', () => {
      // Create two points at same distance but different priority
      const equalTargets = [
        HitTest.pointTarget({ x: 5, y: 0 }, 'low', 1),
        HitTest.pointTarget({ x: 0, y: 5 }, 'high', 100),
      ];
      // Test point is equidistant from both (distance = 5)
      const result = HitTest.collection({ x: 0, y: 0 }, equalTargets, { radius: 6 });
      expect(result?.target?.id).toBe('high');
    });

    it('applies filter function', () => {
      const result = HitTest.collection({ x: 11, y: 10 }, targets, {
        radius: 5,
        filter: (t) => t.id !== 'p1',
      });
      expect(result).toBeNull();
    });
  });

  describe('allInRadius', () => {
    const targets = [
      HitTest.pointTarget({ x: 0, y: 0 }, 'origin'),
      HitTest.pointTarget({ x: 5, y: 0 }, 'near'),
      HitTest.pointTarget({ x: 20, y: 0 }, 'far'),
    ];

    it('returns all targets within radius sorted by distance', () => {
      const results = HitTest.allInRadius({ x: 3, y: 0 }, targets, 10);
      expect(results).toHaveLength(2);
      expect(results[0].target?.id).toBe('near'); // distance = 2
      expect(results[1].target?.id).toBe('origin'); // distance = 3
    });
  });

  describe('inRect', () => {
    const rect: Rect2D = {
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      left: 0,
      top: 0,
      right: 50,
      bottom: 50,
    };

    it('finds points inside rect', () => {
      const targets = [
        HitTest.pointTarget({ x: 25, y: 25 }, 'inside'),
        HitTest.pointTarget({ x: 100, y: 100 }, 'outside'),
      ];
      const results = HitTest.inRect(rect, targets);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('inside');
    });

    it('finds segments fully inside rect', () => {
      const targets = [
        HitTest.segmentTarget(
          Segment.line({ x: 10, y: 10 }, { x: 40, y: 40 }),
          'inside'
        ),
        HitTest.segmentTarget(
          Segment.line({ x: 10, y: 10 }, { x: 100, y: 100 }),
          'partial'
        ),
      ];
      const results = HitTest.inRect(rect, targets);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('inside');
    });
  });

  describe('distanceToTarget', () => {
    it('computes distance to point target', () => {
      const target = HitTest.pointTarget({ x: 3, y: 4 }, 'p');
      expect(HitTest.distanceToTarget({ x: 0, y: 0 }, target)).toBe(5);
    });

    it('computes distance to segment target', () => {
      const target = HitTest.segmentTarget(
        Segment.line({ x: 0, y: 0 }, { x: 10, y: 0 }),
        's'
      );
      expect(HitTest.distanceToTarget({ x: 5, y: 3 }, target)).toBe(3);
    });

    it('returns 0 for point inside rect target', () => {
      const target = HitTest.rectTarget(
        { x: 0, y: 0, width: 10, height: 10, left: 0, top: 0, right: 10, bottom: 10 },
        'r'
      );
      expect(HitTest.distanceToTarget({ x: 5, y: 5 }, target)).toBe(0);
    });
  });
});
