import type { GlyphSnapshot, FontMetrics, FontMetadata } from "@shift/types";

export interface PointMove {
  id: string;
  x: number;
  y: number;
}

export interface FontEngineAPI {
  loadFont(path: string): void;
  saveFont(path: string): void;
  saveFontAsync(path: string): Promise<void>;
  getMetadata(): FontMetadata;
  getMetrics(): FontMetrics;
  getGlyphCount(): number;
  getGlyphUnicodes(): number[];
  getGlyphSvgPath(unicode: number): string | null;
  getGlyphAdvance(unicode: number): number | null;
  getGlyphBbox(unicode: number): [number, number, number, number] | null;
  startEditSession(unicode: number): void;
  endEditSession(): void;
  hasEditSession(): boolean;
  getEditingUnicode(): number | null;
  getSnapshotData(): GlyphSnapshot;
  addEmptyContour(): string;
  addContour(): string;
  getActiveContourId(): string | null;
  closeContour(): string;
  setActiveContour(contourId: string): string;
  clearActiveContour(): string;
  reverseContour(contourId: string): string;
  removeContour(contourId: string): string;
  openContour(contourId: string): string;
  addPoint(x: number, y: number, pointType: "onCurve" | "offCurve", smooth: boolean): string;
  addPointToContour(
    contourId: string,
    x: number,
    y: number,
    pointType: "onCurve" | "offCurve",
    smooth: boolean,
  ): string;
  movePoints(pointIds: string[], dx: number, dy: number): string;
  removePoints(pointIds: string[]): string;
  insertPointBefore(
    beforePointId: string,
    x: number,
    y: number,
    pointType: "onCurve" | "offCurve",
    smooth: boolean,
  ): string;
  toggleSmooth(pointId: string): string;
  pasteContours(contoursJson: string, offsetX: number, offsetY: number): string;
  setPointPositions(moves: PointMove[]): boolean;
  restoreSnapshot(snapshot: GlyphSnapshot): boolean;
}

declare global {
  interface Window {
    shiftFont?: FontEngineAPI;
  }
}
