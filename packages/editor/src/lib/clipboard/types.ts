import type { PointType } from "@shift/types";
import type { Rect2D } from "@shift/geo";
import type { Sizing } from "../../types/frame";

export type { PasteResult } from "../../types/bridge";

/** A point's portable geometry without its source identity. */
export type PointContent = {
  x: number;
  y: number;
  pointType: PointType;
  smooth: boolean;
};

/** A contour's portable geometry without its source identity. */
export type ContourContent = {
  points: PointContent[];
  closed: boolean;
};

/**
 * Portable Shift content detached from live editor state.
 *
 * @remarks
 * `ShiftContent` contains enough geometry to reconstruct editable contours in
 * another layer, document, or clipboard round trip. It does not carry live
 * glyph, layer, contour, point, node, or scene ids; those are minted by the
 * destination when content is pasted or otherwise inserted.
 */
export type ShiftContent = {
  contours: ContourContent[];
  /** Text boxes, absent when none were copied. */
  textBoxes?: TextBoxContent[];
};

/** One piece of a copied text box's text; glyphs travel by name, so they resolve in any font. */
export type TextBoxItemContent =
  | { kind: "character"; codepoint: number }
  | { kind: "glyph"; name: string }
  | { kind: "linebreak" };

/** A text box's portable text, placement, and size, without its node or run ids. */
export type TextBoxContent = {
  items: TextBoxItemContent[];
  /** Top-left corner on the page, Y-down, in scene units. */
  position: { x: number; y: number };
  size: number;
  width: Sizing;
  height: Sizing;
  rotation: number;
  /** Absent in content from before vertical alignment; read as `top`. */
  verticalAlign?: "top" | "middle" | "bottom";
};

/**
 * Versioned envelope written to the system clipboard as JSON.
 * The `format` discriminant lets the editor distinguish its own data from
 * arbitrary text during paste.
 */
export type ClipboardPayload = {
  version: 1;
  format: "shift/glyph-data";
  content: ShiftContent;
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
  | { kind: "content"; content: ShiftContent; source: ClipboardSource }
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
  import(offer: ClipboardOffer): ShiftContent | null | Promise<ShiftContent | null>;
}

/**
 * The OS-level clipboard — the boundary between the {@link Clipboard}
 * orchestrator and the app shell. Production wiring uses
 * {@link electronSystemClipboard}; tests inject an in-memory fake.
 */
export interface SystemClipboard {
  writeText(text: string): Promise<void>;
  readText(): Promise<string>;
}

/** Options controlling where pasted content is placed relative to the original. */
export interface PasteOptions {
  offset: { x: number; y: number };
}
