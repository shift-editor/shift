import { beforeEach, describe, expect, it } from 'vitest';

import { Contour } from '@/lib/core/Contour';

describe('Contour', () => {
  let contour: Contour;

  beforeEach(() => {
    contour = new Contour();
  });

  it('should create a contour', () => {
    expect(contour).toBeDefined();
  });

  it('adding one point to an empty contour should create no segments', () => {
    contour.addPoint(0, 0, 'onCurve');
    expect(contour.segments().length).toBe(0);

    expect(contour.points.length).toBe(1);
  });

  it('adding two points to an empty contour should create one line segment', () => {
    contour.addPoint(0, 0, 'onCurve');
    contour.addPoint(10, 10, 'onCurve');
    const segments = contour.segments();

    expect(segments.length).toBe(1);
    expect(segments[0].type).toBe('line');
  });

  it('adding three points to an empty contour should create two line segments', () => {
    contour.addPoint(0, 0, 'onCurve');
    contour.addPoint(10, 10, 'onCurve');
    contour.addPoint(20, 20, 'onCurve');

    const segments = contour.segments();

    expect(segments.length).toBe(2);

    expect(segments[0].type).toBe('line');
    expect(segments[1].type).toBe('line');

    expect(segments[1].points.anchor1.entityId).toEqual(segments[0].points.anchor2.entityId);
  });

  it('adding two points and then upgrading the line segment should create a cubic segment', () => {
    contour.addPoint(0, 0, 'onCurve');
    const id = contour.addPoint(10, 10, 'onCurve');
    contour.upgradeLineSegment(id);
    const segments = contour.segments();

    expect(segments.length).toBe(1);
    expect(segments[0].type).toBe('cubic');
  });

  it('adding three points with the last closing the contour should create three line segments and a closed contour', () => {
    contour.addPoint(0, 0, 'onCurve');
    contour.addPoint(10, 10, 'onCurve');
    contour.addPoint(20, 20, 'onCurve');
    contour.close();
    const segments = contour.segments();

    expect(contour.closed).toBe(true);
    expect(segments.length).toBe(3);
    expect(segments[2].type).toBe('line');
    expect(segments[2].points.anchor2.entityId).toEqual(segments[0].points.anchor1.entityId);
    expect(segments[2].points.anchor1.entityId).toEqual(segments[1].points.anchor2.entityId);
  });

  describe('point relationships', () => {
    it('single point should have no neighbors', () => {
      contour.addPoint(0, 0, 'onCurve');
      const point = contour.points[0];

      expect(point.prevPoint).toBeNull();
      expect(point.nextPoint).toBeNull();
      expect(point.hasPrevPoint()).toBe(false);
      expect(point.hasNextPoint()).toBe(false);
      expect(point.getNeighbors()).toEqual([]);
    });

    it('two points in open contour should reference each other', () => {
      contour.addPoint(0, 0, 'onCurve');
      contour.addPoint(10, 10, 'onCurve');
      const [point1, point2] = contour.points;

      expect(point1.prevPoint).toBeNull();
      expect(point1.nextPoint).toBe(point2);
      expect(point2.prevPoint).toBe(point1);
      expect(point2.nextPoint).toBeNull();

      expect(point1.getNeighbors()).toEqual([point2]);
      expect(point2.getNeighbors()).toEqual([point1]);
    });

    it('three points in open contour should have correct relationships', () => {
      contour.addPoint(0, 0, 'onCurve');
      contour.addPoint(10, 10, 'onCurve');
      contour.addPoint(20, 20, 'onCurve');
      const [point1, point2, point3] = contour.points;

      expect(point1.prevPoint).toBeNull();
      expect(point1.nextPoint).toBe(point2);

      expect(point2.prevPoint).toBe(point1);
      expect(point2.nextPoint).toBe(point3);

      expect(point3.prevPoint).toBe(point2);
      expect(point3.nextPoint).toBeNull();

      expect(point1.getNeighbors()).toEqual([point2]);
      expect(point2.getNeighbors()).toEqual([point1, point3]);
      expect(point3.getNeighbors()).toEqual([point2]);
    });

    it('three points in closed contour should wrap around', () => {
      contour.addPoint(0, 0, 'onCurve');
      contour.addPoint(10, 10, 'onCurve');
      contour.addPoint(20, 20, 'onCurve');
      contour.close();
      const [point1, point2, point3] = contour.points;

      expect(point1.prevPoint).toBe(point3);
      expect(point1.nextPoint).toBe(point2);

      expect(point2.prevPoint).toBe(point1);
      expect(point2.nextPoint).toBe(point3);

      expect(point3.prevPoint).toBe(point2);
      expect(point3.nextPoint).toBe(point1);

      expect(point1.getNeighbors()).toEqual([point3, point2]);
      expect(point2.getNeighbors()).toEqual([point1, point3]);
      expect(point3.getNeighbors()).toEqual([point2, point1]);
    });

    it('removing a point should update relationships', () => {
      contour.addPoint(0, 0, 'onCurve');
      contour.addPoint(10, 10, 'onCurve');
      contour.addPoint(20, 20, 'onCurve');
      const [point1, point2, point3] = contour.points;

      // Remove middle point
      contour.removePoint(point2.entityId);
      const remainingPoints = contour.points;

      expect(remainingPoints).toEqual([point1, point3]);
      expect(point1.nextPoint).toBe(point3);
      expect(point3.prevPoint).toBe(point1);
    });

    it('inserting a point should update relationships', () => {
      contour.addPoint(0, 0, 'onCurve');
      contour.addPoint(20, 20, 'onCurve');
      const [point1, point3] = contour.points;

      // Insert point between point1 and point3
      const point2Id = contour.insertPointAt(1, 10, 10, 'onCurve');
      const [newPoint1, newPoint2, newPoint3] = contour.points;

      expect(newPoint1.nextPoint).toBe(newPoint2);
      expect(newPoint2.prevPoint).toBe(newPoint1);
      expect(newPoint2.nextPoint).toBe(newPoint3);
      expect(newPoint3.prevPoint).toBe(newPoint2);
    });

    it('upgrading line segment should maintain relationships', () => {
      contour.addPoint(0, 0, 'onCurve');
      const id2 = contour.addPoint(10, 10, 'onCurve');
      contour.upgradeLineSegment(id2);

      const points = contour.points;
      expect(points.length).toBe(4); // 2 original + 2 control points

      // Check that all points have correct relationships
      for (let i = 0; i < points.length; i++) {
        const point = points[i];
        const expectedPrev = i === 0 ? null : points[i - 1];
        const expectedNext = i === points.length - 1 ? null : points[i + 1];

        expect(point.prevPoint).toBe(expectedPrev);
        expect(point.nextPoint).toBe(expectedNext);
      }
    });

    it('cloning a contour should preserve relationships', () => {
      contour.addPoint(0, 0, 'onCurve');
      contour.addPoint(10, 10, 'onCurve');
      contour.addPoint(20, 20, 'onCurve');
      contour.close();

      const clonedContour = contour.clone();
      const clonedPoints = clonedContour.points;

      expect(clonedPoints.length).toBe(3);

      // Check that relationships are preserved in clone
      expect(clonedPoints[0].prevPoint).toBe(clonedPoints[2]);
      expect(clonedPoints[0].nextPoint).toBe(clonedPoints[1]);
      expect(clonedPoints[1].prevPoint).toBe(clonedPoints[0]);
      expect(clonedPoints[1].nextPoint).toBe(clonedPoints[2]);
      expect(clonedPoints[2].prevPoint).toBe(clonedPoints[1]);
      expect(clonedPoints[2].nextPoint).toBe(clonedPoints[0]);
    });
  });
});
