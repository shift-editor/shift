import { describe, it, expect } from 'vitest';

import { Rect } from '@/lib/math/rect';

describe('Rect', () => {
  describe('initilisation', () => {
    it('with x, y and size', () => {
      const rect = new Rect(10, 10, 100, 100);

      expect(rect.x).toBe(10);
      expect(rect.y).toBe(10);
      expect(rect.width).toBe(100);
      expect(rect.height).toBe(100);
    });

    it('from bounds', () => {
      const rect = Rect.fromBounds(10, 20, 50, 50);

      expect(rect.x).toBe(10);
      expect(rect.y).toBe(20);
      expect(rect.width).toBe(40);
      expect(rect.height).toBe(30);
    });
  });

  describe('hit for rectangle at (5, 5) with width 25 and height 25', () => {
    const rect = new Rect(5, 5, 25, 25);

    it('on point (10, 10) is true', () => {
      expect(rect.hit(27, 26)).toBe(true);
    });

    it('on point (35, 35) is false', () => {
      expect(rect.hit(35, 35)).toBe(false);
    });
  });
});
