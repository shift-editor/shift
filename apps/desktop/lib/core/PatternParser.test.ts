import { beforeEach, describe, expect, it } from 'vitest';

import { Contour, ContourPoint } from './Contour';
import { PatternParser, BuildPattern } from './PatternParser';

describe('PatternParser', () => {
  let parser: PatternParser;

  beforeEach(() => {
    parser = new PatternParser();
  });

  it('parse simple pattern', () => {
    const patterns = parser.expand('HCH');
    expect(patterns).toEqual(['HCH']);
  });

  it('parse with character sets', () => {
    const pattern = parser.expand('[NH]SH');
    expect(pattern).toEqual(['NSH', 'HSH']);
  });

  it('parse with multiple character sets', () => {
    const pattern = parser.expand('[NH][SC]H');
    expect(pattern).toEqual(['NSH', 'NCH', 'HSH', 'HCH']);
  });

  it('parse with ALL token in character set', () => {
    const pattern = parser.expand('[X]CH');
    expect(pattern).toEqual(['NCH', 'CCH', 'SCH', 'HCH']);
  });

  it('parse with mixed character sets', () => {
    const pattern = parser.expand('[NH]SH');
    expect(pattern).toEqual(['NSH', 'HSH']);
  });

  it('parse with standalone X token', () => {
    const pattern = parser.expand('XCH');
    expect(pattern).toEqual(['NCH', 'CCH', 'SCH', 'HCH']);
  });

  it('parse with X in the middle', () => {
    const pattern = parser.expand('HXH');
    expect(pattern).toEqual(['HNH', 'HCH', 'HSH', 'HHH']);
  });

  it('parse with multiple X tokens', () => {
    const pattern = parser.expand('XXH');
    expect(pattern).toEqual([
      'NNH',
      'NCH',
      'NSH',
      'NHH',
      'CNH',
      'CCH',
      'CSH',
      'CHH',
      'SNH',
      'SCH',
      'SSH',
      'SHH',
      'HNH',
      'HCH',
      'HSH',
      'HHH',
    ]);
  });

  describe('selected point tests', () => {
    it('parse with selected point token', () => {
      const pattern = parser.expand('@CH');
      expect(pattern).toEqual(['@CH']);
    });

    it('parse with selected point in character set', () => {
      const pattern = parser.expand('[N@]SH');
      expect(pattern).toEqual(['NSH', '@SH']);
    });

    it('parse with selected point in multiple sets', () => {
      const pattern = parser.expand('[N@][SC]H');
      expect(pattern).toEqual(['NSH', 'NCH', '@SH', '@CH']);
    });

    it('parse with selected point and X token', () => {
      const pattern = parser.expand('X@H');
      expect(pattern).toEqual(['N@H', 'C@H', 'S@H', 'H@H']);
    });

    it('parse with selected point in the middle', () => {
      const pattern = parser.expand('H@H');
      expect(pattern).toEqual(['H@H']);
    });
  });

  describe('pattern building with Contour', () => {
    it('builds a simple HCH pattern', () => {
      const contour = new Contour();
      contour.addPoint(0, 0, 'offCurve'); // H
      contour.addPoint(100, 0, 'onCurve'); // C
      contour.addPoint(200, 0, 'offCurve'); // H
      contour.close();

      const points = contour.points;
      expect(points.length).toBe(3);
      expect(points[0].pointType).toBe('offCurve');
      expect(points[1].pointType).toBe('onCurve');
      expect(points[2].pointType).toBe('offCurve');

      // Verify linked list relationships
      expect(points[0].nextPoint).toBe(points[1]);
      expect(points[1].prevPoint).toBe(points[0]);
      expect(points[1].nextPoint).toBe(points[2]);
      expect(points[2].prevPoint).toBe(points[1]);
      expect(points[2].nextPoint).toBe(points[0]);
      expect(points[0].prevPoint).toBe(points[2]);
    });

    it('builds a pattern with character set [NH]SH', () => {
      const contour = new Contour();
      // First point can be either N or H
      contour.addPoint(0, 0, 'onCurve'); // N
      contour.addPoint(100, 0, 'offCurve'); // S
      contour.addPoint(200, 0, 'offCurve'); // H
      contour.close();

      const points = contour.points;
      expect(points.length).toBe(3);
      expect(points[0].pointType).toBe('onCurve');
      expect(points[1].pointType).toBe('offCurve');
      expect(points[2].pointType).toBe('offCurve');

      // Verify linked list relationships
      expect(points[0].nextPoint).toBe(points[1]);
      expect(points[1].prevPoint).toBe(points[0]);
      expect(points[1].nextPoint).toBe(points[2]);
      expect(points[2].prevPoint).toBe(points[1]);
    });

    it('builds a pattern with X token (all point types)', () => {
      const contour = new Contour();
      // X expands to N, C, H, S
      contour.addPoint(0, 0, 'onCurve'); // N
      contour.addPoint(100, 0, 'onCurve'); // C
      contour.addPoint(200, 0, 'offCurve'); // H
      contour.close();

      const points = contour.points;
      expect(points.length).toBe(3);
      expect(points[0].pointType).toBe('onCurve');
      expect(points[1].pointType).toBe('onCurve');
      expect(points[2].pointType).toBe('offCurve');

      // Verify linked list relationships
      expect(points[0].nextPoint).toBe(points[1]);
      expect(points[1].prevPoint).toBe(points[0]);
      expect(points[1].nextPoint).toBe(points[2]);
      expect(points[2].prevPoint).toBe(points[1]);
    });

    it('builds a pattern with selected point', () => {
      const contour = new Contour();
      contour.addPoint(0, 0, 'offCurve'); // H
      contour.addPoint(100, 0, 'onCurve', true); // @ (selected point)
      contour.addPoint(200, 0, 'offCurve'); // H
      contour.close();

      const points = contour.points;
      expect(points.length).toBe(3);
      expect(points[0].pointType).toBe('offCurve');
      expect(points[1].pointType).toBe('onCurve');
      expect(points[1].smooth).toBe(true); // Selected point should be smooth
      expect(points[2].pointType).toBe('offCurve');

      // Verify linked list relationships
      expect(points[0].nextPoint).toBe(points[1]);
      expect(points[1].prevPoint).toBe(points[0]);
      expect(points[1].nextPoint).toBe(points[2]);
      expect(points[2].prevPoint).toBe(points[1]);
    });

    it('builds a symmetric pattern H@H', () => {
      const contour = new Contour();
      contour.addPoint(0, 0, 'offCurve'); // H
      contour.addPoint(100, 0, 'onCurve', true); // @ (selected point)
      contour.addPoint(200, 0, 'offCurve'); // H
      contour.close();

      const points = contour.points;
      expect(points.length).toBe(3);
      expect(points[0].pointType).toBe('offCurve');
      expect(points[1].pointType).toBe('onCurve');
      expect(points[1].smooth).toBe(true);
      expect(points[2].pointType).toBe('offCurve');

      // Verify linked list relationships
      expect(points[0].nextPoint).toBe(points[1]);
      expect(points[1].prevPoint).toBe(points[0]);
      expect(points[1].nextPoint).toBe(points[2]);
      expect(points[2].prevPoint).toBe(points[1]);
      expect(points[2].nextPoint).toBe(points[0]);
      expect(points[0].prevPoint).toBe(points[2]);
    });

    it('builds a complex pattern with multiple sets and X', () => {
      const contour = new Contour();
      // [NH][SC]H pattern
      contour.addPoint(0, 0, 'onCurve'); // N
      contour.addPoint(100, 0, 'offCurve'); // S
      contour.addPoint(200, 0, 'offCurve'); // H
      contour.close();

      const points = contour.points;
      expect(points.length).toBe(3);
      expect(points[0].pointType).toBe('onCurve');
      expect(points[1].pointType).toBe('offCurve');
      expect(points[2].pointType).toBe('offCurve');

      // Verify linked list relationships
      expect(points[0].nextPoint).toBe(points[1]);
      expect(points[1].prevPoint).toBe(points[0]);
      expect(points[1].nextPoint).toBe(points[2]);
      expect(points[2].prevPoint).toBe(points[1]);
      expect(points[2].nextPoint).toBe(points[0]);
      expect(points[0].prevPoint).toBe(points[2]);
    });
  });

  describe('BuildPattern', () => {
    it('builds pattern for a point with no neighbors', () => {
      const contour = new Contour();
      contour.addPoint(0, 0, 'onCurve');
      const selectedPoints = new Set<ContourPoint>();

      const pattern = BuildPattern(contour.points[0], selectedPoints);
      expect(pattern).toBe('NSN');
    });

    it('builds pattern for a point with both neighbors', () => {
      const contour = new Contour();
      contour.addPoint(0, 0, 'onCurve'); // prev
      contour.addPoint(100, 0, 'onCurve'); // current
      contour.addPoint(200, 0, 'onCurve'); // next
      contour.close();

      const selectedPoints = new Set<ContourPoint>();
      const pattern = BuildPattern(contour.points[1], selectedPoints);
      expect(pattern).toBe('SSS');
    });

    it('builds pattern for a point with selected neighbors', () => {
      const contour = new Contour();
      contour.addPoint(0, 0, 'onCurve'); // prev
      contour.addPoint(100, 0, 'onCurve'); // current
      contour.addPoint(200, 0, 'onCurve'); // next
      contour.close();

      const selectedPoints = new Set<ContourPoint>([contour.points[0], contour.points[2]]);
      const pattern = BuildPattern(contour.points[1], selectedPoints);
      expect(pattern).toBe('@S@');
    });

    it('builds pattern for a point with handle neighbors', () => {
      const contour = new Contour();
      contour.addPoint(0, 0, 'offCurve'); // prev (H)
      contour.addPoint(100, 0, 'onCurve'); // current (S)
      contour.addPoint(200, 0, 'offCurve'); // next (H)
      contour.close();

      const selectedPoints = new Set<ContourPoint>();
      const pattern = BuildPattern(contour.points[1], selectedPoints);
      expect(pattern).toBe('HSH');
    });

    it('builds pattern for a point with selected handle neighbors', () => {
      const contour = new Contour();
      contour.addPoint(0, 0, 'offCurve'); // prev (H)
      contour.addPoint(100, 0, 'onCurve'); // current (S)
      contour.addPoint(200, 0, 'offCurve'); // next (H)
      contour.close();

      const selectedPoints = new Set<ContourPoint>([contour.points[0], contour.points[2]]);
      const pattern = BuildPattern(contour.points[1], selectedPoints);
      expect(pattern).toBe('@S@');
    });

    it('builds pattern for a point with mixed neighbors', () => {
      const contour = new Contour();
      contour.addPoint(0, 0, 'offCurve'); // prev (H)
      contour.addPoint(100, 0, 'onCurve'); // current (S)
      contour.addPoint(200, 0, 'onCurve'); // next (S)
      contour.close();

      const selectedPoints = new Set<ContourPoint>();
      const pattern = BuildPattern(contour.points[1], selectedPoints);
      expect(pattern).toBe('HSS');
    });

    it('builds pattern with only one neighbor', () => {
      const contour = new Contour();
      contour.addPoint(100, 0, 'onCurve'); // current
      contour.addPoint(200, 0, 'offCurve'); // next

      const selectedPoints = new Set<ContourPoint>();
      const pattern = BuildPattern(contour.points[0], selectedPoints);
      expect(pattern).toBe('NSH');
    });

    it('builds pattern with complex point types', () => {
      const contour = new Contour();
      contour.addPoint(0, 0, 'onCurve'); // prev (S)
      contour.addPoint(100, 0, 'offCurve'); // current (H)
      contour.addPoint(200, 0, 'onCurve'); // next (S)
      contour.close();

      const selectedPoints = new Set<ContourPoint>();
      const pattern = BuildPattern(contour.points[1], selectedPoints);
      expect(pattern).toBe('SHS');
    });
  });

  describe('complex pattern tests', () => {
    it('handles multiple ALL tokens in sets', () => {
      const pattern = parser.expand('[XX]H');
      expect(pattern).toEqual(['NH', 'CH', 'SH', 'HH', 'NH', 'CH', 'SH', 'HH']);
    });

    it('handles empty character sets', () => {
      const pattern = parser.expand('[]H');
      expect(pattern).toEqual([]);
    });

    it('handles invalid character sets gracefully', () => {
      const pattern = parser.expand('[Z]H');
      expect(pattern).toEqual(['ZH']);
    });

    it('handles patterns with multiple selected points', () => {
      const pattern = parser.expand('@H@');
      expect(pattern).toEqual(['@H@']);
    });

    it('handles patterns with mixed selected and regular points', () => {
      const pattern = parser.expand('@[CS]H');
      expect(pattern).toEqual(['@CH', '@SH']);
    });
  });
});
