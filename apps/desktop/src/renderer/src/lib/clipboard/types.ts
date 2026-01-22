import type { PointSnapshot, Rect2D } from "@shift/types";

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
