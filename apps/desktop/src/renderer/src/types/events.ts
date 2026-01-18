import type { PointId, ContourId } from './ids';
import type { Point2D } from './math';

export type EditorEventMap = {
  'points:added': { pointIds: PointId[] };
  'points:removed': { pointIds: PointId[] };
  'points:moved': { pointIds: PointId[]; delta: Point2D };
  'contour:closed': { contourId: ContourId };
  'selection:changed': { selected: Set<PointId>; added: PointId[]; removed: PointId[] };
  'segment:upgraded': { contourId: ContourId };
  'font:loaded': { path: string };
};

export type EditorEventName = keyof EditorEventMap;

export type EventHandler<K extends EditorEventName> = (data: EditorEventMap[K]) => void;

export interface IEventEmitter {
  on<K extends EditorEventName>(event: K, handler: EventHandler<K>): void;
  off<K extends EditorEventName>(event: K, handler: EventHandler<K>): void;
  emit<K extends EditorEventName>(event: K, data: EditorEventMap[K]): void;
}
