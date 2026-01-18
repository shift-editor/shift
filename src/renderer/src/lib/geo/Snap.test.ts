import { describe, it, expect } from 'vitest';
import { Snap } from './Snap';
import { Segment } from './Segment';
import { Vec2 } from './Vec2';

describe('Snap', () => {
  describe('toGrid', () => {
    it('snaps to nearest grid point', () => {
      expect(Snap.toGrid({ x: 12, y: 18 }, 10)).toEqual({ x: 10, y: 20 });
      expect(Snap.toGrid({ x: 15, y: 25 }, 10)).toEqual({ x: 20, y: 30 });
    });

    it('respects custom origin', () => {
      expect(Snap.toGrid({ x: 12, y: 18 }, 10, { x: 5, y: 5 })).toEqual({
        x: 15,
        y: 15,
      });
    });

    it('handles negative coordinates', () => {
      expect(Snap.toGrid({ x: -12, y: -18 }, 10)).toEqual({ x: -10, y: -20 });
    });
  });

  describe('toGridXY', () => {
    it('snaps with different x and y spacing', () => {
      expect(Snap.toGridXY({ x: 12, y: 18 }, 10, 5)).toEqual({ x: 10, y: 20 });
    });
  });

  describe('toAngle', () => {
    it('snaps to nearest allowed angle', () => {
      const anchor = { x: 0, y: 0 };
      const angles = [0, 90, 180, 270];

      // Point at ~30 degrees, should snap to 0
      const result1 = Snap.toAngle({ x: 10, y: 5 }, anchor, angles, 45);
      expect(result1.snapped).toBe(true);
      expect(result1.point.y).toBeCloseTo(0);

      // Point at ~60 degrees, should snap to 90 (within 45 degree tolerance)
      const result2 = Snap.toAngle({ x: 5, y: 10 }, anchor, angles, 45);
      expect(result2.snapped).toBe(true);
      expect(result2.point.x).toBeCloseTo(0);
    });

    it('does not snap when outside tolerance', () => {
      const result = Snap.toAngle({ x: 10, y: 10 }, { x: 0, y: 0 }, [0, 90], 10);
      expect(result.snapped).toBe(false);
    });

    it('preserves distance from anchor', () => {
      const anchor = { x: 0, y: 0 };
      const point = { x: 3, y: 4 }; // distance = 5
      const result = Snap.toAngle(point, anchor, [0], 90);

      expect(result.snapped).toBe(true);
      expect(Vec2.dist(result.point, anchor)).toBeCloseTo(5);
    });

    it('includes angle label', () => {
      const result = Snap.toAngle({ x: 10, y: 0 }, { x: 0, y: 0 }, [0, 45, 90], 10);
      expect(result.label).toBe('0°');
    });
  });

  describe('toLine', () => {
    it('projects point onto line', () => {
      const linePoint = { x: 0, y: 0 };
      const lineDir = { x: 1, y: 0 };
      const result = Snap.toLine({ x: 5, y: 10 }, linePoint, lineDir);
      expect(result).toEqual({ x: 5, y: 0 });
    });

    it('works with arbitrary line direction', () => {
      const result = Snap.toLine({ x: 0, y: 10 }, { x: 0, y: 0 }, { x: 1, y: 1 });
      expect(result.x).toBeCloseTo(5);
      expect(result.y).toBeCloseTo(5);
    });
  });

  describe('toSegment', () => {
    it('snaps to nearest point on segment', () => {
      const segment = Segment.line({ x: 0, y: 0 }, { x: 10, y: 0 });
      const result = Snap.toSegment({ x: 5, y: 10 }, segment);
      expect(result).toEqual({ x: 5, y: 0 });
    });

    it('clamps to segment endpoints', () => {
      const segment = Segment.line({ x: 0, y: 0 }, { x: 10, y: 0 });
      expect(Snap.toSegment({ x: -5, y: 0 }, segment)).toEqual({ x: 0, y: 0 });
      expect(Snap.toSegment({ x: 15, y: 0 }, segment)).toEqual({ x: 10, y: 0 });
    });
  });

  describe('find', () => {
    const targets = [
      Snap.pointTarget({ x: 10, y: 10 }, 'endpoint', 100, 'endpoint'),
      Snap.pointTarget({ x: 5, y: 5 }, 'midpoint', 50, 'midpoint'),
      Snap.gridTarget(10, 'grid', 10),
    ];

    it('finds best snap within threshold', () => {
      const result = Snap.find({ x: 9, y: 9 }, targets, { threshold: 5 });
      expect(result.snapped).toBe(true);
      expect(result.target?.id).toBe('endpoint');
    });

    it('returns unsnapped result when nothing within threshold', () => {
      // Use point targets only (no grid) to test threshold behavior
      const pointsOnly = [
        Snap.pointTarget({ x: 10, y: 10 }, 'endpoint', 100, 'endpoint'),
        Snap.pointTarget({ x: 5, y: 5 }, 'midpoint', 50, 'midpoint'),
      ];
      const result = Snap.find({ x: 100, y: 100 }, pointsOnly, { threshold: 5 });
      expect(result.snapped).toBe(false);
      expect(result.point).toEqual({ x: 100, y: 100 });
    });

    it('respects priority for equidistant snaps', () => {
      // Both targets at same distance
      const equalTargets = [
        Snap.pointTarget({ x: 5, y: 0 }, 'low', 1),
        Snap.pointTarget({ x: 0, y: 5 }, 'high', 100),
      ];
      const result = Snap.find({ x: 0, y: 0 }, equalTargets, { threshold: 10 });
      expect(result.target?.id).toBe('high');
    });

    it('applies type filter', () => {
      const result = Snap.find({ x: 9, y: 9 }, targets, {
        threshold: 20,
        typeFilter: ['grid'],
      });
      expect(result.snapped).toBe(true);
      expect(result.target?.id).toBe('grid');
    });

    it('applies custom filter', () => {
      // Use point targets only to test filter without grid interference
      const pointsOnly = [
        Snap.pointTarget({ x: 10, y: 10 }, 'endpoint', 100, 'endpoint'),
        Snap.pointTarget({ x: 5, y: 5 }, 'midpoint', 50, 'midpoint'),
      ];
      const result = Snap.find({ x: 9, y: 9 }, pointsOnly, {
        threshold: 3,
        filter: (t) => t.id !== 'endpoint',
      });
      // Only endpoint is within range 3 (distance ~1.41), midpoint is too far (~5.6)
      expect(result.snapped).toBe(false);
    });
  });

  describe('findAll', () => {
    const targets = [
      Snap.pointTarget({ x: 0, y: 0 }, 'a', 10),
      Snap.pointTarget({ x: 5, y: 0 }, 'b', 20),
      Snap.pointTarget({ x: 10, y: 0 }, 'c', 5),
    ];

    it('returns all snaps within threshold sorted by distance', () => {
      const results = Snap.findAll({ x: 3, y: 0 }, targets, { threshold: 10 });
      expect(results).toHaveLength(3);
      expect(results[0].target?.id).toBe('b'); // dist=2, priority=20
      expect(results[1].target?.id).toBe('a'); // dist=3, priority=10
      expect(results[2].target?.id).toBe('c'); // dist=7, priority=5
    });
  });

  describe('target factories', () => {
    it('creates point targets', () => {
      const target = Snap.pointTarget({ x: 1, y: 2 }, 'p1', 50, 'my label');
      expect(target.type).toBe('point');
      expect(target.point).toEqual({ x: 1, y: 2 });
      expect(target.id).toBe('p1');
      expect(target.priority).toBe(50);
      expect(target.label).toBe('my label');
    });

    it('creates line targets', () => {
      const segment = Segment.line({ x: 0, y: 0 }, { x: 10, y: 10 });
      const target = Snap.lineTarget(segment, 'l1', 25, 'perpendicular');
      expect(target.type).toBe('line');
      expect(target.mode).toBe('perpendicular');
    });

    it('creates grid targets', () => {
      const target = Snap.gridTarget(10, 'g1', 5, { x: 5, y: 5 }, 20);
      expect(target.type).toBe('grid');
      expect(target.spacing).toBe(10);
      expect(target.spacingY).toBe(20);
      expect(target.origin).toEqual({ x: 5, y: 5 });
    });

    it('creates angle targets', () => {
      const target = Snap.angleTarget(
        { x: 0, y: 0 },
        [0, 45, 90],
        5,
        'a1',
        30
      );
      expect(target.type).toBe('angle');
      expect(target.angles).toEqual([0, 45, 90]);
      expect(target.tolerance).toBe(5);
    });

    it('creates extension targets', () => {
      const target = Snap.extensionTarget(
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        'ext1',
        15,
        'horizontal'
      );
      expect(target.type).toBe('extension');
    });
  });

  describe('line snap modes', () => {
    const segment = Segment.line({ x: 0, y: 0 }, { x: 10, y: 0 });

    it('nearest mode snaps to closest point on segment', () => {
      const target = Snap.lineTarget(segment, 'l', 0, 'nearest');
      const result = Snap.find({ x: 5, y: 5 }, [target], { threshold: 10 });
      expect(result.snapped).toBe(true);
      expect(result.point).toEqual({ x: 5, y: 0 });
    });

    it('endpoint-only mode snaps only to endpoints', () => {
      const target = Snap.lineTarget(segment, 'l', 0, 'endpoint-only');
      const result = Snap.find({ x: 4, y: 0 }, [target], { threshold: 10 });
      expect(result.snapped).toBe(true);
      // Should snap to nearest endpoint (0,0) since 4 < 6
      expect(result.point).toEqual({ x: 0, y: 0 });
    });

    it('perpendicular mode only snaps when perpendicular foot is on segment', () => {
      const target = Snap.lineTarget(segment, 'l', 0, 'perpendicular');

      // Point above segment - should snap
      const result1 = Snap.find({ x: 5, y: 5 }, [target], { threshold: 10 });
      expect(result1.snapped).toBe(true);

      // Point to the left - perpendicular foot is off segment
      const result2 = Snap.find({ x: -5, y: 5 }, [target], { threshold: 10 });
      expect(result2.snapped).toBe(false);
    });
  });

  describe('preset configurations', () => {
    it('provides common angle sets', () => {
      expect(Snap.angles.orthogonal).toEqual([0, 90, 180, 270]);
      expect(Snap.angles.diagonal).toHaveLength(8);
      expect(Snap.angles.fine).toHaveLength(24);
    });

    it('provides priority levels', () => {
      expect(Snap.priorities.endpoint).toBeGreaterThan(Snap.priorities.midpoint);
      expect(Snap.priorities.midpoint).toBeGreaterThan(Snap.priorities.grid);
    });
  });

  describe('extension snap', () => {
    it('snaps to infinite line extension', () => {
      const target = Snap.extensionTarget(
        { x: 10, y: 0 },
        { x: 1, y: 0 },
        'horiz'
      );
      const result = Snap.find({ x: 100, y: 5 }, [target], { threshold: 10 });
      expect(result.snapped).toBe(true);
      expect(result.point.y).toBeCloseTo(0);
      expect(result.point.x).toBeCloseTo(100);
    });
  });
});
