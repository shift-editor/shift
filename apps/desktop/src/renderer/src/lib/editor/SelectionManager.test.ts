import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createSelectionManager, type SelectionManager } from './SelectionManager';
import type { PointId } from '@/types/ids';
import { effect } from '../reactive/signal';

const asPointId = (id: number): PointId => id as unknown as PointId;

describe('SelectionManager', () => {
  let manager: SelectionManager;

  beforeEach(() => {
    manager = createSelectionManager();
  });

  describe('initial state', () => {
    it('should start with empty selection', () => {
      expect(manager.selectedPoints.size).toBe(0);
    });

    it('should start in committed mode', () => {
      expect(manager.mode).toBe('committed');
    });
  });

  describe('select', () => {
    it('should select a single point', () => {
      manager.select(asPointId(1));
      expect(manager.selectedPoints.has(asPointId(1))).toBe(true);
      expect(manager.selectedPoints.size).toBe(1);
    });

    it('should clear previous selection when selecting', () => {
      manager.select(asPointId(1));
      manager.select(asPointId(2));
      expect(manager.selectedPoints.has(asPointId(1))).toBe(false);
      expect(manager.selectedPoints.has(asPointId(2))).toBe(true);
      expect(manager.selectedPoints.size).toBe(1);
    });
  });

  describe('selectMultiple', () => {
    it('should select multiple points', () => {
      const points = new Set([asPointId(1), asPointId(2), asPointId(3)]);
      manager.selectMultiple(points);
      expect(manager.selectedPoints.size).toBe(3);
      expect(manager.selectedPoints.has(asPointId(1))).toBe(true);
      expect(manager.selectedPoints.has(asPointId(2))).toBe(true);
      expect(manager.selectedPoints.has(asPointId(3))).toBe(true);
    });

    it('should replace previous selection', () => {
      manager.select(asPointId(1));
      manager.selectMultiple(new Set([asPointId(2), asPointId(3)]));
      expect(manager.selectedPoints.has(asPointId(1))).toBe(false);
      expect(manager.selectedPoints.size).toBe(2);
    });
  });

  describe('addToSelection', () => {
    it('should add point to existing selection', () => {
      manager.select(asPointId(1));
      manager.addToSelection(asPointId(2));
      expect(manager.selectedPoints.size).toBe(2);
      expect(manager.selectedPoints.has(asPointId(1))).toBe(true);
      expect(manager.selectedPoints.has(asPointId(2))).toBe(true);
    });
  });

  describe('toggleSelection', () => {
    it('should add point if not selected', () => {
      manager.toggleSelection(asPointId(1));
      expect(manager.selectedPoints.has(asPointId(1))).toBe(true);
    });

    it('should remove point if already selected', () => {
      manager.select(asPointId(1));
      manager.toggleSelection(asPointId(1));
      expect(manager.selectedPoints.has(asPointId(1))).toBe(false);
    });
  });

  describe('clearSelection', () => {
    it('should clear all selected points', () => {
      manager.selectMultiple(new Set([asPointId(1), asPointId(2), asPointId(3)]));
      manager.clearSelection();
      expect(manager.selectedPoints.size).toBe(0);
    });
  });

  describe('setMode', () => {
    it('should set mode to preview', () => {
      manager.setMode('preview');
      expect(manager.mode).toBe('preview');
    });

    it('should set mode to committed', () => {
      manager.setMode('preview');
      manager.setMode('committed');
      expect(manager.mode).toBe('committed');
    });
  });

  describe('isSelected', () => {
    it('should return true for selected points', () => {
      manager.select(asPointId(1));
      expect(manager.isSelected(asPointId(1))).toBe(true);
    });

    it('should return false for non-selected points', () => {
      expect(manager.isSelected(asPointId(1))).toBe(false);
    });
  });

  describe('signal reactivity', () => {
    it('should trigger effect when selectedPoints changes', () => {
      const callback = vi.fn();
      const fx = effect(() => {
        manager.selectedPoints;
        callback();
      });

      callback.mockClear();
      manager.select(asPointId(1));
      expect(callback).toHaveBeenCalledTimes(1);

      callback.mockClear();
      manager.addToSelection(asPointId(2));
      expect(callback).toHaveBeenCalledTimes(1);

      fx.dispose();
    });

    it('should trigger effect when mode changes', () => {
      const callback = vi.fn();
      const fx = effect(() => {
        manager.mode;
        callback();
      });

      callback.mockClear();
      manager.setMode('preview');
      expect(callback).toHaveBeenCalledTimes(1);

      callback.mockClear();
      manager.setMode('committed');
      expect(callback).toHaveBeenCalledTimes(1);

      fx.dispose();
    });
  });
});
