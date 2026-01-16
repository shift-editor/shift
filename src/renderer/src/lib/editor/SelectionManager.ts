import type { HandleState } from '@/types/handle';
import type { PointId } from '@/types/ids';

export type SelectionMode = 'preview' | 'committed';

export interface SelectionManager {
  readonly selectedPoints: ReadonlySet<PointId>;
  readonly hoveredPoint: PointId | null;
  readonly mode: SelectionMode;

  select(pointId: PointId): void;
  selectMultiple(pointIds: Set<PointId>): void;
  addToSelection(pointId: PointId): void;
  toggleSelection(pointId: PointId): void;
  clearSelection(): void;
  setHovered(pointId: PointId | null): void;
  clearHovered(): void;
  setMode(mode: SelectionMode): void;
  isSelected(pointId: PointId): boolean;
  getHandleState(pointId: PointId): HandleState;
}

interface SelectionState {
  selectedPoints: Set<PointId>;
  hoveredPoint: PointId | null;
  mode: SelectionMode;
}

export function createSelectionManager(onChange?: () => void): SelectionManager {
  const state: SelectionState = {
    selectedPoints: new Set(),
    hoveredPoint: null,
    mode: 'committed',
  };

  const notify = () => onChange?.();

  return {
    get selectedPoints(): ReadonlySet<PointId> {
      return state.selectedPoints;
    },

    get hoveredPoint(): PointId | null {
      return state.hoveredPoint;
    },

    get mode(): SelectionMode {
      return state.mode;
    },

    select(pointId: PointId): void {
      state.selectedPoints.clear();
      state.selectedPoints.add(pointId);
      notify();
    },

    selectMultiple(pointIds: Set<PointId>): void {
      state.selectedPoints = new Set(pointIds);
      notify();
    },

    addToSelection(pointId: PointId): void {
      state.selectedPoints.add(pointId);
      notify();
    },

    toggleSelection(pointId: PointId): void {
      if (state.selectedPoints.has(pointId)) {
        state.selectedPoints.delete(pointId);
      } else {
        state.selectedPoints.add(pointId);
      }
      notify();
    },

    clearSelection(): void {
      state.selectedPoints.clear();
      notify();
    },

    setHovered(pointId: PointId | null): void {
      state.hoveredPoint = pointId;
      notify();
    },

    clearHovered(): void {
      state.hoveredPoint = null;
      notify();
    },

    setMode(mode: SelectionMode): void {
      state.mode = mode;
      notify();
    },

    isSelected(pointId: PointId): boolean {
      return state.selectedPoints.has(pointId);
    },

    getHandleState(pointId: PointId): HandleState {
      if (state.selectedPoints.has(pointId)) {
        return 'selected';
      }
      if (state.hoveredPoint === pointId) {
        return 'hovered';
      }
      return 'idle';
    },
  };
}
