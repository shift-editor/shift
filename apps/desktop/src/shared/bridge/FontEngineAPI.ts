import type { ContourId, RenderContourSnapshot } from "@shift/types";

export interface PointMove {
  id: string;
  x: number;
  y: number;
}

export interface AnchorMove {
  id: string;
  x: number;
  y: number;
}

export interface CompositeComponentPayload {
  componentGlyphName: string;
  sourceUnicodes: number[];
  contours: RenderContourSnapshot[];
}

export interface CompositeComponentsPayload {
  glyphName: string;
  components: CompositeComponentPayload[];
}

export interface FontEngineAPI {
  // ── Font I/O ──
  loadFont(path: string): void;
  saveFont(path: string): void;
  saveFontAsync(path: string): Promise<void>;

  // ── Font Queries ──
  getMetadata(): string;
  getMetrics(): string;
  getGlyphCount(): number;
  getGlyphUnicodes(): number[];
  getGlyphNameForUnicode(unicode: number): string | null;
  getGlyphUnicodesForName(glyphName: string): number[];
  getDependentUnicodes(unicode: number): number[];
  getDependentUnicodesByName(glyphName: string): number[];
  getGlyphSvgPath(unicode: number): string | null;
  getGlyphSvgPathByName(glyphName: string): string | null;
  getGlyphAdvance(unicode: number): number | null;
  getGlyphAdvanceByName(glyphName: string): number | null;
  getGlyphBbox(unicode: number): [number, number, number, number] | null;
  getGlyphBboxByName(glyphName: string): [number, number, number, number] | null;
  getGlyphCompositeComponents(glyphName: string): string | null;

  // ── Session Lifecycle ──
  startEditSession(unicode: number): void;
  startEditSessionByName(glyphName: string): void;
  endEditSession(): void;
  hasEditSession(): boolean;
  getEditingUnicode(): number | null;
  getEditingGlyphName(): string | null;
  getSnapshotData(): string;

  // ── Contour Operations ──
  addContour(): string;
  getActiveContourId(): ContourId | null;
  closeContour(): string;
  setActiveContour(contourId: string): string;
  clearActiveContour(): string;
  openContour(contourId: string): string;
  reverseContour(contourId: string): string;
  removeContour(contourId: string): string;

  // ── Glyph Properties ──
  setXAdvance(width: number): string;

  // ── Point Operations ──
  addPoint(x: number, y: number, pointType: "onCurve" | "offCurve", smooth: boolean): string;
  addPointToContour(
    contourId: string,
    x: number,
    y: number,
    pointType: "onCurve" | "offCurve",
    smooth: boolean,
  ): string;
  insertPointBefore(
    beforePointId: string,
    x: number,
    y: number,
    pointType: "onCurve" | "offCurve",
    smooth: boolean,
  ): string;
  movePoints(pointIds: string[], dx: number, dy: number): string;
  moveAnchors(anchorIds: string[], dx: number, dy: number): string;
  removePoints(pointIds: string[]): string;
  toggleSmooth(pointId: string): string;

  // ── Clipboard ──
  pasteContours(contoursJson: string, offsetX: number, offsetY: number): string;

  // ── Drag Operations ──
  setPointPositions(moves: PointMove[]): boolean;
  setAnchorPositions(moves: AnchorMove[]): boolean;
  restoreSnapshot(snapshotJson: string): boolean;
}

declare global {
  interface Window {
    shiftFont?: FontEngineAPI;
  }
}
