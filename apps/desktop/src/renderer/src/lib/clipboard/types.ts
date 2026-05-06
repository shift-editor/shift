import type { PointType } from "@shift/types";
import type { Rect2D } from "@shift/geo";

export type { PasteResult } from "@/types/bridge";

/** A point's data without its identity, used for clipboard serialization. */
export type PointContent = {
  x: number;
  y: number;
  pointType: PointType;
  smooth: boolean;
};

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
    sourceApp: "shift";
    timestamp: number;
  };
};

/**
 * One offered OS clipboard representation. The current Electron bridge only
 * exposes text, but the shape leaves room for image bytes and richer MIME
 * payloads without changing the editor paste API.
 */
export interface ClipboardOffer {
  readonly mimeType: string;
  readonly text?: string;
  readonly bytes?: Uint8Array;
}

export type ClipboardSource = "shift" | "svg" | "fontra" | "glyphs" | "image";

export type ClipboardReadResult =
  | { kind: "empty" }
  | { kind: "glyph"; content: ClipboardContent; source: ClipboardSource }
  | { kind: "unsupported"; offeredTypes: readonly string[]; reason?: string };

export interface ClipboardWriteMetadata {
  readonly sourceGlyph?: string;
}

/**
 * Strategy for importing external clipboard offers (e.g. SVG paths) into the
 * editor's internal clipboard format. Register importers to support additional
 * paste sources.
 */
export interface ClipboardImporter {
  readonly id: ClipboardSource;
  pick(offers: readonly ClipboardOffer[]): ClipboardOffer | null;
  import(offer: ClipboardOffer): ClipboardContent | null | Promise<ClipboardContent | null>;
}

/**
 * The OS-level clipboard — the boundary between the {@link Clipboard}
 * orchestrator and Electron's `clipboard` module (via preload). Production
 * wiring uses {@link electronSystemClipboard}; tests inject an in-memory fake.
 */
export interface SystemClipboard {
  writeText(text: string): void;
  readText(): string;
}

/** Options controlling where pasted content is placed relative to the original. */
export interface PasteOptions {
  offset: { x: number; y: number };
}
