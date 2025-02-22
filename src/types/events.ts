import { Ident } from "@/lib/core/EntityId";

export type EditorEventMap = {
  "contour:updated": { contourId: Ident };
  "point:added": { pointId: Ident; position: { x: number; y: number } };
  "point:moved": { pointId: Ident; position: { x: number; y: number } };
  "point:removed": { pointId: Ident };
  "selection:changed": { selectedIds: Ident[] };
};

export type EditorEvent = keyof EditorEventMap;
