import { describe, it, expect, vi, beforeEach } from 'vitest';

import { drawHandle, drawHandleLast, drawGuides } from './index';
import type { IRenderer } from '@/types/graphics';
import type { HandleState, HandleType } from '@/types/handle';
import { Path2D } from '@/lib/graphics/Path';

function createMockRenderer(): IRenderer {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    flush: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn(),
    lineWidth: 1,
    strokeStyle: 'black',
    fillStyle: 'white',
    antiAlias: false,
    dashPattern: [],
    setStyle: vi.fn(),
    drawLine: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillCircle: vi.fn(),
    strokeCircle: vi.fn(),
    createPath: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    cubicTo: vi.fn(),
    arcTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    transform: vi.fn(),
  };
}

describe('handles API', () => {
  let ctx: IRenderer;

  beforeEach(() => {
    ctx = createMockRenderer();
  });

  describe('drawHandle', () => {
    const handleTypes: Exclude<HandleType, 'last'>[] = [
      'corner',
      'control',
      'smooth',
      'first',
      'direction',
    ];

    const handleStates: HandleState[] = ['idle', 'hovered', 'selected'];

    it.each(handleTypes)('should dispatch to correct renderer for %s handle', (type) => {
      drawHandle(ctx, type, 100, 100, 'idle');
      expect(ctx.setStyle).toHaveBeenCalled();
    });

    it.each(handleStates)('should work for %s state', (state) => {
      drawHandle(ctx, 'corner', 50, 50, state);
      expect(ctx.setStyle).toHaveBeenCalled();
    });

    it('should pass options to direction handle', () => {
      drawHandle(ctx, 'direction', 100, 100, 'idle', { isCounterClockWise: true });
      expect(ctx.setStyle).toHaveBeenCalled();
      expect(ctx.arcTo).toHaveBeenCalled();
    });
  });

  describe('drawHandleLast', () => {
    it('should draw last handle with position data', () => {
      drawHandleLast(ctx, { x0: 100, y0: 100, x1: 200, y1: 200 }, 'idle');

      expect(ctx.setStyle).toHaveBeenCalled();
      expect(ctx.stroke).toHaveBeenCalled();
    });
  });

  describe('drawGuides', () => {
    it('should stroke the provided path', () => {
      const path = new Path2D();
      path.moveTo(0, 0);
      path.lineTo(100, 100);

      drawGuides(ctx, path);

      expect(ctx.stroke).toHaveBeenCalledWith(path);
    });
  });
});
