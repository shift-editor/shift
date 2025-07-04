import { beforeEach, describe, expect, it } from 'vitest';

import { Contour, ContourPoint } from './Contour';
import { EditEngine } from './EditEngine';

describe('EditEngine', () => {
  let editEngine: EditEngine;
  let mockContext: {
    getSelectedPoints: () => Set<ContourPoint>;
    movePointTo: (point: ContourPoint, dx: number, dy: number) => void;
  };
  let contour: Contour;

  beforeEach(() => {
    contour = new Contour();
    mockContext = {
      getSelectedPoints: () => new Set<ContourPoint>(),
      movePointTo: (point: ContourPoint, x: number, y: number) => {
        point.set_x(x);
        point.set_y(y);
      },
    };
    editEngine = new EditEngine(mockContext);
  });

  describe('applyEdits', () => {
    it('should move selected points directly', () => {
      // Create a simple contour with 3 points
      contour.addPoint(0, 0, 'onCurve');
      contour.addPoint(100, 0, 'onCurve');
      contour.addPoint(200, 0, 'onCurve');
      contour.close();

      // Select the middle point
      const selectedPoints = new Set<ContourPoint>([contour.points[1]]);
      mockContext.getSelectedPoints = () => selectedPoints;

      // Apply edit
      const edits = editEngine.applyEdits(10, 20);

      // Verify the point was moved
      expect(contour.points[1].x).toBe(110);
      expect(contour.points[1].y).toBe(20);
      expect(edits.length).toBe(1);
      expect(edits[0].point).toBe(contour.points[1]);
      expect(edits[0].edits.length).toBe(1);
      expect(edits[0].edits[0].from).toEqual({ x: 100, y: 0 });
      expect(edits[0].edits[0].to).toEqual({ x: 110, y: 20 });
    });

    it('should apply handle movement rules', () => {
      // Create a contour with a handle point
      contour.addPoint(0, 0, 'offCurve'); // Handle
      contour.addPoint(100, 0, 'onCurve'); // Anchor
      contour.addPoint(200, 0, 'offCurve'); // Handle
      contour.close();

      // Select the anchor point
      const selectedPoints = new Set<ContourPoint>([contour.points[1]]);
      mockContext.getSelectedPoints = () => selectedPoints;

      // Apply edit
      const edits = editEngine.applyEdits(10, 20);

      // Verify both handles were moved
      expect(contour.points[0].x).toBe(10);
      expect(contour.points[0].y).toBe(20);
      expect(contour.points[2].x).toBe(210);
      expect(contour.points[2].y).toBe(20);
      expect(edits.length).toBe(2); // One for direct move, one for rule application
    });

    it('should handle multiple selected points', () => {
      // Create a contour with multiple points
      contour.addPoint(0, 0, 'onCurve');
      contour.addPoint(100, 0, 'onCurve');
      contour.addPoint(200, 0, 'onCurve');
      contour.close();

      // Select multiple points
      const selectedPoints = new Set<ContourPoint>([contour.points[0], contour.points[2]]);
      mockContext.getSelectedPoints = () => selectedPoints;

      // Apply edit
      const edits = editEngine.applyEdits(10, 20);

      // Verify both points were moved
      expect(contour.points[0].x).toBe(10);
      expect(contour.points[0].y).toBe(20);
      expect(contour.points[2].x).toBe(210);
      expect(contour.points[2].y).toBe(20);
      expect(edits.length).toBe(2);
    });

    it('should handle points without neighbors', () => {
      // Create a single point
      contour.addPoint(0, 0, 'onCurve');
      const selectedPoints = new Set<ContourPoint>([contour.points[0]]);
      mockContext.getSelectedPoints = () => selectedPoints;

      // Apply edit
      const edits = editEngine.applyEdits(10, 20);

      // Verify the point was moved
      expect(contour.points[0].x).toBe(10);
      expect(contour.points[0].y).toBe(20);
      expect(edits.length).toBe(1);
    });
  });
});
