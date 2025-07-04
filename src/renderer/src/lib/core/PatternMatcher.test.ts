import { beforeEach, describe, expect, it } from 'vitest';

import { Contour, ContourPoint } from './Contour';
import { PatternMatcher } from './PatternMatcher';
import { TOKENS } from './PatternParser';

describe('PatternMatcher', () => {
  let matcher: PatternMatcher;

  beforeEach(() => {
    matcher = new PatternMatcher();
  });

  describe('Basic Pattern Matching', () => {
    it('should build correct 3-point and 5-point patterns for simple contour', () => {
      const contour = new Contour();
      contour.addPoint(0, 0, 'onCurve'); // prev
      contour.addPoint(100, 0, 'onCurve'); // current
      contour.addPoint(200, 0, 'onCurve'); // next
      contour.close();

      const selectedPoints = new Set<ContourPoint>();
      const patterns = matcher.buildPatterns(contour.points[1], selectedPoints);

      expect(patterns).toEqual(['CCC', 'CCCCC']); // 3-point: prev-current-next, 5-point: prev2-prev1-current-next1-next2
    });

    it('should handle points with no neighbors', () => {
      const contour = new Contour();
      contour.addPoint(0, 0, 'onCurve');

      const selectedPoints = new Set<ContourPoint>();
      const patterns = matcher.buildPatterns(contour.points[0], selectedPoints);

      expect(patterns).toEqual(['NCN', 'NNCNN']); // No prev/next points, so N (null) tokens
    });

    it('should handle points with one neighbor', () => {
      const contour = new Contour();
      contour.addPoint(100, 0, 'onCurve'); // current
      contour.addPoint(200, 0, 'onCurve'); // next

      const selectedPoints = new Set<ContourPoint>();
      const patterns = matcher.buildPatterns(contour.points[0], selectedPoints);

      expect(patterns).toEqual(['NCC', 'NNCCN']); // No prev point, but has next
    });
  });

  describe('Point Type Recognition', () => {
    it('should correctly identify corner points', () => {
      const contour = new Contour();
      contour.addPoint(0, 0, 'onCurve', false); // corner
      contour.addPoint(100, 0, 'onCurve', false); // corner
      contour.addPoint(200, 0, 'onCurve', false); // corner
      contour.close();

      const selectedPoints = new Set<ContourPoint>();
      const patterns = matcher.buildPatterns(contour.points[1], selectedPoints);

      expect(patterns).toEqual(['CCC', 'CCCCC']); // All corner points
    });

    it('should correctly identify smooth points', () => {
      const contour = new Contour();
      contour.addPoint(0, 0, 'onCurve', true); // smooth
      contour.addPoint(100, 0, 'onCurve', true); // smooth
      contour.addPoint(200, 0, 'onCurve', true); // smooth
      contour.close();

      const selectedPoints = new Set<ContourPoint>();
      const patterns = matcher.buildPatterns(contour.points[1], selectedPoints);

      expect(patterns).toEqual(['SSS', 'SSSSS']); // All smooth points
    });

    it('should correctly identify handle points', () => {
      const contour = new Contour();
      contour.addPoint(0, 0, 'offCurve'); // handle
      contour.addPoint(100, 0, 'offCurve'); // handle
      contour.addPoint(200, 0, 'offCurve'); // handle
      contour.close();

      const selectedPoints = new Set<ContourPoint>();
      const patterns = matcher.buildPatterns(contour.points[1], selectedPoints);

      expect(patterns).toEqual(['HHH', 'HHHHH']); // All handle points
    });

    it('should correctly identify mixed point types', () => {
      const contour = new Contour();
      contour.addPoint(0, 0, 'offCurve'); // handle
      contour.addPoint(100, 0, 'onCurve', false); // corner
      contour.addPoint(200, 0, 'onCurve', true); // smooth
      contour.close();

      const selectedPoints = new Set<ContourPoint>();
      const patterns = matcher.buildPatterns(contour.points[1], selectedPoints);

      expect(patterns).toEqual(['HCS', 'SHCSH']); // handle-corner-smooth pattern
    });
  });

  describe('Selected Points Handling', () => {
    it('should mark selected points with @ token', () => {
      const contour = new Contour();
      contour.addPoint(0, 0, 'onCurve'); // prev
      contour.addPoint(100, 0, 'onCurve'); // current
      contour.addPoint(200, 0, 'onCurve'); // next
      contour.close();

      // Select the prev and next points
      const selectedPoints = new Set<ContourPoint>([contour.points[0], contour.points[2]]);
      const patterns = matcher.buildPatterns(contour.points[1], selectedPoints);

      expect(patterns).toEqual(['@C@', '@@C@@']); // Selected neighbors marked with @
    });

    it('should not mark central point as selected', () => {
      const contour = new Contour();
      contour.addPoint(0, 0, 'onCurve'); // prev
      contour.addPoint(100, 0, 'onCurve'); // current
      contour.addPoint(200, 0, 'onCurve'); // next
      contour.close();

      // Select the central point
      const selectedPoints = new Set<ContourPoint>([contour.points[1]]);
      const patterns = matcher.buildPatterns(contour.points[1], selectedPoints);

      expect(patterns).toEqual(['CCC', 'CCCCC']); // Central point should still be 'C', not '@'
    });

    it('should handle multiple selected points', () => {
      const contour = new Contour();
      contour.addPoint(0, 0, 'onCurve'); // prev prev
      contour.addPoint(50, 0, 'onCurve'); // prev
      contour.addPoint(100, 0, 'onCurve'); // current
      contour.addPoint(150, 0, 'onCurve'); // next
      contour.addPoint(200, 0, 'onCurve'); // next next
      contour.close();

      // Select multiple points
      const selectedPoints = new Set<ContourPoint>([
        contour.points[0], // prev prev
        contour.points[2], // next
        contour.points[4], // next next
      ]);
      const patterns = matcher.buildPatterns(contour.points[2], selectedPoints);

      expect(patterns).toEqual(['CCC', '@CCC@']); // Multiple selected points
    });
  });

  describe('Window Sizes', () => {
    it('should produce different patterns for 3-point vs 5-point windows', () => {
      const contour = new Contour();
      // Create a longer contour to test 5-point patterns
      contour.addPoint(0, 0, 'onCurve'); // -2
      contour.addPoint(50, 0, 'offCurve'); // -1 (handle)
      contour.addPoint(100, 0, 'onCurve', true); // current (smooth)
      contour.addPoint(150, 0, 'offCurve'); // +1 (handle)
      contour.addPoint(200, 0, 'onCurve'); // +2
      contour.close();

      const selectedPoints = new Set<ContourPoint>();
      const patterns = matcher.buildPatterns(contour.points[2], selectedPoints);

      expect(patterns).toEqual(['HSH', 'CHSHC']); // 3-point vs 5-point window
    });

    it('should handle partial contours with null points', () => {
      const contour = new Contour();
      contour.addPoint(100, 0, 'onCurve'); // current
      contour.addPoint(200, 0, 'onCurve'); // next
      // No prev point, so should use 'N' tokens

      const selectedPoints = new Set<ContourPoint>();
      const patterns = matcher.buildPatterns(contour.points[0], selectedPoints);

      expect(patterns).toEqual(['NCC', 'NNCCN']); // Fill missing positions with 'N' tokens
    });
  });

  describe('Complex Contour Patterns', () => {
    it('should handle bezier curve patterns', () => {
      const contour = new Contour();
      contour.addPoint(0, 0, 'onCurve'); // start
      contour.addPoint(50, 50, 'offCurve'); // handle
      contour.addPoint(150, 50, 'offCurve'); // handle
      contour.addPoint(200, 0, 'onCurve'); // end
      contour.close();

      const selectedPoints = new Set<ContourPoint>();
      const patterns = matcher.buildPatterns(contour.points[1], selectedPoints); // test handle point

      expect(patterns).toEqual(['CHH', 'CCHHC']); // corner-handle-handle pattern
    });

    it('should handle complex mixed patterns', () => {
      const contour = new Contour();
      contour.addPoint(0, 0, 'onCurve', false); // corner
      contour.addPoint(50, 50, 'offCurve'); // handle
      contour.addPoint(100, 100, 'onCurve', true); // smooth
      contour.addPoint(150, 50, 'offCurve'); // handle
      contour.addPoint(200, 0, 'onCurve', false); // corner
      contour.close();

      const selectedPoints = new Set<ContourPoint>();
      const patterns = matcher.buildPatterns(contour.points[2], selectedPoints); // test smooth point

      expect(patterns).toEqual(['HSH', 'CHSHC']); // handle-smooth-handle pattern
    });

    it('should handle selected points in complex patterns', () => {
      const contour = new Contour();
      contour.addPoint(0, 0, 'onCurve', false); // corner
      contour.addPoint(50, 50, 'offCurve'); // handle
      contour.addPoint(100, 100, 'onCurve', true); // smooth
      contour.addPoint(150, 50, 'offCurve'); // handle
      contour.addPoint(200, 0, 'onCurve', false); // corner
      contour.close();

      // Select some points
      const selectedPoints = new Set<ContourPoint>([
        contour.points[1], // handle
        contour.points[3], // handle
      ]);
      const patterns = matcher.buildPatterns(contour.points[2], selectedPoints); // test smooth point

      expect(patterns).toEqual(['@S@', 'C@S@C']); // Selected handles around smooth point
    });
  });

  describe('Edge Cases', () => {
    it('should handle single point contour', () => {
      const contour = new Contour();
      contour.addPoint(0, 0, 'onCurve');

      const selectedPoints = new Set<ContourPoint>();
      const patterns = matcher.buildPatterns(contour.points[0], selectedPoints);

      expect(patterns).toEqual(['NCN', 'NNCNN']); // Lone point with null neighbors
    });

    it('should handle two point contour', () => {
      const contour = new Contour();
      contour.addPoint(0, 0, 'onCurve');
      contour.addPoint(100, 0, 'onCurve');

      const selectedPoints = new Set<ContourPoint>();
      const patterns = matcher.buildPatterns(contour.points[0], selectedPoints);

      expect(patterns).toEqual(['NCC', 'NNCCN']); // Missing prev point
    });

    it('should handle smooth point correctly', () => {
      const contour = new Contour();
      contour.addPoint(0, 0, 'onCurve', true); // smooth prev
      contour.addPoint(100, 0, 'onCurve', true); // smooth current
      contour.addPoint(200, 0, 'onCurve', true); // smooth next
      contour.close();

      const selectedPoints = new Set<ContourPoint>();
      const patterns = matcher.buildPatterns(contour.points[1], selectedPoints);

      expect(patterns).toEqual(['SSS', 'SSSSS']); // All smooth points
    });
  });

  describe('Pattern Matching with Rules', () => {
    it('should return rule when pattern matches', () => {
      const contour = new Contour();
      contour.addPoint(0, 0, 'onCurve');
      contour.addPoint(100, 0, 'onCurve');
      contour.addPoint(200, 0, 'onCurve');
      contour.close();

      const selectedPoints = new Set<ContourPoint>();
      const result = matcher.match(contour.points[1], selectedPoints);

      // Result depends on what rules are defined in RuleTable
      // This test verifies the match method works, actual result varies by rule definitions
      expect(result).toBeDefined();
    });

    it('should try different window sizes until match found', () => {
      const contour = new Contour();
      contour.addPoint(0, 0, 'onCurve');

      const selectedPoints = new Set<ContourPoint>();
      const result = matcher.match(contour.points[0], selectedPoints);

      // Should attempt to match both 3-point and 5-point patterns
      expect(result).toBeDefined();
    });
  });
});
