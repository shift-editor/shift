import type {
  ContourId,
  GlyphSnapshot,
  PointId,
  PointType,
  FontMetadata,
  FontMetrics,
} from "@shift/types";
import type { Signal } from "@/lib/reactive/signal";
import type { FontEngineAPI, PointMove } from "@shared/bridge/FontEngineAPI";
import { Bounds } from "@shift/geo";

export interface CommandResponse {
  snapshot: GlyphSnapshot;
  affectedPointIds: PointId[];
}

export interface EngineCore {
  readonly $glyph: Signal<GlyphSnapshot | null>;
  readonly raw: FontEngineAPI;
  hasSession(): boolean;
  getGlyph(): GlyphSnapshot | null;
  emitGlyph(glyph: GlyphSnapshot | null): void;

  loadFont(path: string): void;
  saveFontAsync(path: string): Promise<void>;

  getMetadata(): FontMetadata;
  getMetrics(): FontMetrics;
  getGlyphCount(): number;
  getGlyphUnicodes(): number[];
  getGlyphSvgPath(unicode: number): string | null;
  getGlyphAdvance(unicode: number): number | null;
  getGlyphBbox(unicode: number): Bounds | null;

  startEditSession(unicode: number): void;
  endEditSession(): void;
  hasEditSession(): boolean;
  getEditingUnicode(): number | null;
  addEmptyContour(): string;
  getActiveContourId(): ContourId | null;

  getSnapshot(): GlyphSnapshot;
  restoreSnapshot(snapshot: GlyphSnapshot): void;

  setPointPositions(moves: PointMove[]): boolean;

  pasteContours(contoursJson: string, offsetX: number, offsetY: number): PasteResult;
}

export interface PasteResult {
  success: boolean;
  createdPointIds: PointId[];
  createdContourIds: ContourId[];
  error?: string;
}

export interface PointEdit {
  id?: PointId;
  x: number;
  y: number;
  pointType: PointType;
  smooth: boolean;
}
