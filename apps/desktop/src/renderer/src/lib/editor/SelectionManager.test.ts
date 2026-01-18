import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createSelectionManager, type SelectionManager } from './SelectionManager';
import type { PointId } from '@/types/ids';

const asPointId = (id: number): PointId => id as unknown as PointId;

describe('SelectionManager', () => {
  let manager: SelectionManager;
  let onChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onChange = vi.fn();
    manager = createSelectionManager(onChange);
  });

  describe('initial state', () => {
    it('should start with empty selection', () => {
      expect(manager.selectedPoints.size).toBe(0);
    });

    it('should start with no hovered point', () => {
      expect(manager.hoveredPoint).toBeNull();
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

    it('should call onChange when selecting', () => {
      manager.select(asPointId(1));
      expect(onChange).toHaveBeenCalled();
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

    it('should call onChange', () => {
      manager.selectMultiple(new Set([asPointId(1)]));
      expect(onChange).toHaveBeenCalled();
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

    it('should call onChange', () => {
      manager.addToSelection(asPointId(1));
      expect(onChange).toHaveBeenCalled();
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

    it('should call onChange', () => {
      manager.toggleSelection(asPointId(1));
      expect(onChange).toHaveBeenCalled();
    });
  });

  describe('clearSelection', () => {
    it('should clear all selected points', () => {
      manager.selectMultiple(new Set([asPointId(1), asPointId(2), asPointId(3)]));
      manager.clearSelection();
      expect(manager.selectedPoints.size).toBe(0);
    });

    it('should call onChange', () => {
      manager.clearSelection();
      expect(onChange).toHaveBeenCalled();
    });
  });

  describe('setHovered', () => {
    it('should set hovered point', () => {
      manager.setHovered(asPointId(1));
      expect(manager.hoveredPoint).toBe(asPointId(1));
    });

    it('should allow null', () => {
      manager.setHovered(asPointId(1));
      manager.setHovered(null);
      expect(manager.hoveredPoint).toBeNull();
    });

    it('should call onChange', () => {
      manager.setHovered(asPointId(1));
      expect(onChange).toHaveBeenCalled();
    });
  });

  describe('clearHovered', () => {
    it('should clear hovered point', () => {
      manager.setHovered(asPointId(1));
      manager.clearHovered();
      expect(manager.hoveredPoint).toBeNull();
    });

    it('should call onChange', () => {
      manager.clearHovered();
      expect(onChange).toHaveBeenCalled();
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

    it('should call onChange', () => {
      manager.setMode('preview');
      expect(onChange).toHaveBeenCalled();
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

  describe('getHandleState', () => {
    it('should return selected for selected points', () => {
      manager.select(asPointId(1));
      expect(manager.getHandleState(asPointId(1))).toBe('selected');
    });

    it('should return hovered for hovered points', () => {
      manager.setHovered(asPointId(1));
      expect(manager.getHandleState(asPointId(1))).toBe('hovered');
    });

    it('should return idle for non-selected non-hovered points', () => {
      expect(manager.getHandleState(asPointId(1))).toBe('idle');
    });

    it('should prioritize selected over hovered', () => {
      manager.select(asPointId(1));
      manager.setHovered(asPointId(1));
      expect(manager.getHandleState(asPointId(1))).toBe('selected');
    });
  });

  describe('without onChange callback', () => {
    it('should work without onChange callback', () => {
      const managerWithoutCallback = createSelectionManager();
      managerWithoutCallback.select(asPointId(1));
      expect(managerWithoutCallback.selectedPoints.has(asPointId(1))).toBe(true);
    });
  });
});
