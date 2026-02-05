import type { Glyph, PointId, PointSnapshot, Rect2D } from "@shift/types";
import type { SegmentId } from "@/types/indicator";

export type { PasteResult } from "@/engine/editing";

export type PointContent = Omit<PointSnapshot, "id">;

export type ContourContent = {
  points: PointContent[];
  closed: boolean;
};

export type ClipboardContent = {
  contours: ContourContent[];
};

export type ClipboardPayload = {
  version: 1;
  format: "shift/glyph-data";
  content: ClipboardContent;
  metadata: {
    bounds: Rect2D;
    sourceGlyph?: string;
    timestamp: number;
  };
};

export interface ClipboardImporter {
  readonly name: string;
  canImport(text: string): boolean;
  import(text: string): ClipboardContent | null;
}

export interface ClipboardState {
  content: ClipboardContent | null;
  bounds: Rect2D | null;
  timestamp: number;
}

export interface PasteOptions {
  offset: { x: number; y: number };
}

export interface ClipboardServiceDeps {
  getGlyph: () => Glyph | null;
  getSelectedPointIds: () => readonly PointId[];
  getSelectedSegmentIds: () => readonly SegmentId[];
}
