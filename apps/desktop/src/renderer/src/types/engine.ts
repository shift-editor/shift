import type {
  ContourId,
  GlyphSnapshot,
  PointId,
  PointType,
  FontMetadata,
  FontMetrics,
} from "@shift/types";
import type { Signal } from "@/lib/reactive/signal";
import type { PointMove } from "@shared/bridge/FontEngineAPI";
import { Bounds } from "@shift/geo";

export interface CommandResponse {
  snapshot: GlyphSnapshot;
  affectedPointIds: PointId[];
}

export interface EngineCore {
  readonly $glyph: Signal<GlyphSnapshot | null>;
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

  addPoint(x: number, y: number, pointType: PointType, smooth: boolean): CommandResponse;
  addPointToContour(
    contourId: ContourId,
    x: number,
    y: number,
    pointType: PointType,
    smooth: boolean,
  ): CommandResponse;
  movePoints(pointIds: PointId[], dx: number, dy: number): CommandResponse;
  removePoints(pointIds: PointId[]): CommandResponse;
  insertPointBefore(
    beforePointId: PointId,
    x: number,
    y: number,
    pointType: PointType,
    smooth: boolean,
  ): CommandResponse;
  toggleSmooth(pointId: PointId): CommandResponse;
  addContour(): CommandResponse;
  closeContour(): CommandResponse;
  setActiveContour(contourId: ContourId): CommandResponse;
  clearActiveContour(): CommandResponse;
  reverseContour(contourId: ContourId): CommandResponse;
  removeContour(contourId: ContourId): CommandResponse;
  openContour(contourId: ContourId): CommandResponse;

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
