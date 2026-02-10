import type { Glyph, PointId, PointSnapshot, Rect2D } from "@shift/types";
import type { SegmentId } from "@/types/indicator";

export type { PasteResult } from "@/types/engine";

/** A point's data without its identity, used for clipboard serialization. */
export type PointContent = Omit<PointSnapshot, "id">;

/** A single contour as stored in the clipboard. */
export type ContourContent = {
  points: PointContent[];
  closed: boolean;
};

/** The geometry that the clipboard carries -- one or more contours. */
export type ClipboardContent = {
  contours: ContourContent[];
};

/**
 * Versioned envelope written to the system clipboard as JSON.
 * The `format` discriminant lets the editor distinguish its own data from
 * arbitrary text during paste.
 */
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

/**
 * Strategy for importing external clipboard text (e.g. SVG paths) into
 * the editor's internal clipboard format. Register importers to support
 * additional paste sources.
 */
export interface ClipboardImporter {
  readonly name: string;
  canImport(text: string): boolean;
  import(text: string): ClipboardContent | null;
}

/** Current in-memory clipboard state held by the clipboard service. */
export interface ClipboardState {
  content: ClipboardContent | null;
  bounds: Rect2D | null;
  timestamp: number;
}

/** Options controlling where pasted content is placed relative to the original. */
export interface PasteOptions {
  offset: { x: number; y: number };
}

/** Dependencies injected into the clipboard service to keep it decoupled from the editor. */
export interface ClipboardServiceDeps {
  getGlyph: () => Glyph | null;
  getSelectedPointIds: () => readonly PointId[];
  getSelectedSegmentIds: () => readonly SegmentId[];
}
