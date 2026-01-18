import type { PointId } from '@/types/ids';
import { signal, type WritableSignal } from '../reactive/signal';

export type SelectionMode = 'preview' | 'committed';

export interface SelectionManager {
  readonly selectedPoints: ReadonlySet<PointId>;
  readonly mode: SelectionMode;

  select(pointId: PointId): void;
  selectMultiple(pointIds: Set<PointId>): void;
  addToSelection(pointId: PointId): void;
  removeFromSelection(pointId: PointId): void;
  toggleSelection(pointId: PointId): void;
  clearSelection(): void;
  hasSelection(): boolean;
  setMode(mode: SelectionMode): void;
  isSelected(pointId: PointId): boolean;
}

export function createSelectionManager(): SelectionManager {
  const selectedPoints: WritableSignal<ReadonlySet<PointId>> = signal(new Set());
  const mode: WritableSignal<SelectionMode> = signal('committed');

  return {
    get selectedPoints(): ReadonlySet<PointId> {
      return selectedPoints.value;
    },

    get mode(): SelectionMode {
      return mode.value;
    },

    select(pointId: PointId): void {
      selectedPoints.value = new Set([pointId]);
    },

    selectMultiple(pointIds: Set<PointId>): void {
      selectedPoints.value = new Set(pointIds);
    },

    addToSelection(pointId: PointId): void {
      const next = new Set(selectedPoints.peek());
      next.add(pointId);
      selectedPoints.value = next;
    },

    removeFromSelection(pointId: PointId): void {
      const next = new Set(selectedPoints.peek());
      next.delete(pointId);
      selectedPoints.value = next;
    },

    toggleSelection(pointId: PointId): void {
      const next = new Set(selectedPoints.peek());
      if (next.has(pointId)) {
        next.delete(pointId);
      } else {
        next.add(pointId);
      }
      selectedPoints.value = next;
    },

    clearSelection(): void {
      selectedPoints.value = new Set();
    },

    hasSelection(): boolean {
      return selectedPoints.peek().size > 0;
    },

    setMode(m: SelectionMode): void {
      mode.value = m;
    },

    isSelected(pointId: PointId): boolean {
      return selectedPoints.peek().has(pointId);
    },
  };
}
