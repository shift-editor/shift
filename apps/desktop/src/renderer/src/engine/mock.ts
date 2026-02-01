/**
 * MockFontEngine - In-memory implementation for testing.
 *
 * Implements the FontEngineAPI interface without requiring
 * the Rust backend or Electron context.
 */

import type { FontEngineAPI, PointMove } from "@shared/bridge/FontEngineAPI";
import type {
  PointType,
  CommandResult,
  PointId,
  GlyphSnapshot,
  FontMetadata,
  FontMetrics,
} from "@shift/types";

interface MockPoint {
  id: string;
  x: number;
  y: number;
  pointType: PointType;
  smooth: boolean;
}

interface MockContour {
  id: string;
  points: MockPoint[];
  closed: boolean;
}

interface MockSnapshot {
  unicode: number;
  name: string;
  xAdvance: number;
  contours: MockContour[];
  activeContourId: string | null;
}

/**
 * Mock implementation of FontEngineAPI for testing.
 */
export class MockFontEngine implements FontEngineAPI {
  #snapshot: MockSnapshot | null = null;
  #nextId = 1;

  #generateId(): string {
    return String(this.#nextId++);
  }

  // ═══════════════════════════════════════════════════════════
  // FONT LOADING
  // ═══════════════════════════════════════════════════════════

  loadFont(_path: string): void {
    // No-op in mock
  }

  saveFont(_path: string): void {
    // No-op in mock
  }

  async saveFontAsync(_path: string): Promise<void> {
    // No-op in mock
  }

  // ═══════════════════════════════════════════════════════════
  // FONT INFO
  // ═══════════════════════════════════════════════════════════

  getMetadata(): FontMetadata {
    return {
      familyName: "Mock Font",
      styleName: "Regular",
      versionMajor: 1,
      versionMinor: 0,
      copyright: null,
      trademark: null,
      designer: null,
      designerUrl: null,
      manufacturer: null,
      manufacturerUrl: null,
      license: null,
      licenseUrl: null,
      description: null,
      note: null,
    };
  }

  getMetrics(): FontMetrics {
    return {
      unitsPerEm: 1000,
      ascender: 800,
      descender: -200,
      capHeight: 700,
      xHeight: 500,
      lineGap: 0,
      italicAngle: 0,
      underlinePosition: -100,
      underlineThickness: 50,
    };
  }

  getGlyphCount(): number {
    return 256;
  }

  // ═══════════════════════════════════════════════════════════
  // EDIT SESSION
  // ═══════════════════════════════════════════════════════════

  startEditSession(unicode: number): void {
    this.#snapshot = {
      unicode,
      name: String.fromCodePoint(unicode),
      xAdvance: 500,
      contours: [],
      activeContourId: null,
    };
  }

  endEditSession(): void {
    this.#snapshot = null;
  }

  hasEditSession(): boolean {
    return this.#snapshot !== null;
  }

  getEditingUnicode(): number | null {
    return this.#snapshot?.unicode ?? null;
  }

  // ═══════════════════════════════════════════════════════════
  // SNAPSHOT METHODS
  // ═══════════════════════════════════════════════════════════

  getSnapshotData(): GlyphSnapshot {
    if (!this.#snapshot) {
      throw new Error("No active edit session");
    }
    return this.#snapshot as unknown as GlyphSnapshot;
  }

  restoreSnapshot(snapshot: GlyphSnapshot): boolean {
    this.#snapshot = snapshot as unknown as MockSnapshot;
    return true;
  }

  // ═══════════════════════════════════════════════════════════
  // CONTOUR OPERATIONS
  // ═══════════════════════════════════════════════════════════

  addEmptyContour(): string {
    if (!this.#snapshot) throw new Error("No active edit session");

    const contourId = this.#generateId();
    this.#snapshot.contours.push({
      id: contourId,
      points: [],
      closed: false,
    });
    this.#snapshot.activeContourId = contourId;

    return contourId;
  }

  addContour(): string {
    this.addEmptyContour();
    return this.#makeResult(true, []);
  }

  getActiveContourId(): string | null {
    return this.#snapshot?.activeContourId ?? null;
  }

  closeContour(): string {
    if (!this.#snapshot) return this.#makeResult(false, [], "No active edit session");

    const activeContour = this.#snapshot.contours.find(
      (c) => c.id === this.#snapshot!.activeContourId,
    );
    if (activeContour) {
      activeContour.closed = true;
    }

    return this.#makeResult(true, []);
  }

  setActiveContour(contourId: string): string {
    if (!this.#snapshot) return this.#makeResult(false, [], "No active edit session");

    const contour = this.#snapshot.contours.find((c) => c.id === contourId);
    if (!contour) {
      return this.#makeResult(false, [], `Contour ${contourId} not found`);
    }

    this.#snapshot.activeContourId = contourId;
    return this.#makeResult(true, []);
  }

  clearActiveContour(): string {
    if (!this.#snapshot) return this.#makeResult(false, [], "No active edit session");

    this.#snapshot.activeContourId = null;
    return this.#makeResult(true, []);
  }

  reverseContour(contourId: string): string {
    if (!this.#snapshot) return this.#makeResult(false, [], "No active edit session");

    const contour = this.#snapshot.contours.find((c) => c.id === contourId);
    if (!contour) {
      return this.#makeResult(false, [], `Contour ${contourId} not found`);
    }

    contour.points.reverse();
    return this.#makeResult(true, []);
  }

  removeContour(contourId: string): string {
    if (!this.#snapshot) return this.#makeResult(false, [], "No active edit session");

    const index = this.#snapshot.contours.findIndex((c) => c.id === contourId);
    if (index === -1) {
      return this.#makeResult(false, [], `Contour ${contourId} not found`);
    }

    this.#snapshot.contours.splice(index, 1);

    if (this.#snapshot.activeContourId === contourId) {
      this.#snapshot.activeContourId =
        this.#snapshot.contours.length > 0 ? this.#snapshot.contours[0].id : null;
    }

    return this.#makeResult(true, []);
  }

  openContour(contourId: string): string {
    if (!this.#snapshot) return this.#makeResult(false, [], "No active edit session");

    const contour = this.#snapshot.contours.find((c) => c.id === contourId);
    if (!contour) {
      return this.#makeResult(false, [], `Contour ${contourId} not found`);
    }

    contour.closed = false;
    return this.#makeResult(true, []);
  }

  // ═══════════════════════════════════════════════════════════
  // POINT OPERATIONS
  // ═══════════════════════════════════════════════════════════

  addPoint(x: number, y: number, pointType: PointType, smooth: boolean): string {
    if (!this.#snapshot) return this.#makeResult(false, [], "No active edit session");

    // Auto-create contour if needed
    if (!this.#snapshot.activeContourId) {
      this.addEmptyContour();
    }

    const activeContour = this.#snapshot.contours.find(
      (c) => c.id === this.#snapshot!.activeContourId,
    );
    if (!activeContour) {
      return this.#makeResult(false, [], "No active contour");
    }

    const pointId = this.#generateId();
    activeContour.points.push({ id: pointId, x, y, pointType, smooth });

    return this.#makeResult(true, [pointId]);
  }

  addPointToContour(
    contourId: string,
    x: number,
    y: number,
    pointType: PointType,
    smooth: boolean,
  ): string {
    if (!this.#snapshot) return this.#makeResult(false, [], "No active edit session");

    const contour = this.#snapshot.contours.find((c) => c.id === contourId);
    if (!contour) {
      return this.#makeResult(false, [], `Contour ${contourId} not found`);
    }

    const pointId = this.#generateId();
    contour.points.push({ id: pointId, x, y, pointType, smooth });

    return this.#makeResult(true, [pointId]);
  }

  movePoints(pointIds: string[], dx: number, dy: number): string {
    if (!this.#snapshot) return this.#makeResult(false, [], "No active edit session");

    const moved: string[] = [];

    for (const contour of this.#snapshot.contours) {
      for (const point of contour.points) {
        if (pointIds.includes(point.id)) {
          point.x += dx;
          point.y += dy;
          moved.push(point.id);
        }
      }
    }

    return this.#makeResult(true, moved);
  }

  removePoints(pointIds: string[]): string {
    if (!this.#snapshot) return this.#makeResult(false, [], "No active edit session");

    for (const contour of this.#snapshot.contours) {
      contour.points = contour.points.filter((p) => !pointIds.includes(p.id));
    }

    return this.#makeResult(true, pointIds);
  }

  insertPointBefore(
    beforePointId: string,
    x: number,
    y: number,
    pointType: PointType,
    smooth: boolean,
  ): string {
    if (!this.#snapshot) return this.#makeResult(false, [], "No active edit session");

    for (const contour of this.#snapshot.contours) {
      const index = contour.points.findIndex((p) => p.id === beforePointId);
      if (index !== -1) {
        const newPointId = this.#generateId();
        contour.points.splice(index, 0, { id: newPointId, x, y, pointType, smooth });
        return this.#makeResult(true, [newPointId]);
      }
    }

    return this.#makeResult(false, [], `Point ${beforePointId} not found`);
  }

  toggleSmooth(pointId: string): string {
    if (!this.#snapshot) return this.#makeResult(false, [], "No active edit session");

    for (const contour of this.#snapshot.contours) {
      const point = contour.points.find((p) => p.id === pointId);
      if (point) {
        point.smooth = !point.smooth;
        return this.#makeResult(true, [pointId]);
      }
    }

    return this.#makeResult(false, [], `Point ${pointId} not found`);
  }

  // ═══════════════════════════════════════════════════════════
  // LIGHTWEIGHT DRAG OPERATIONS
  // ═══════════════════════════════════════════════════════════

  setPointPositions(moves: PointMove[]): boolean {
    if (!this.#snapshot) return false;

    for (const move of moves) {
      for (const contour of this.#snapshot.contours) {
        const point = contour.points.find((p) => p.id === move.id);
        if (point) {
          point.x = move.x;
          point.y = move.y;
          break;
        }
      }
    }

    return true;
  }

  // ═══════════════════════════════════════════════════════════
  // CLIPBOARD OPERATIONS
  // ═══════════════════════════════════════════════════════════

  pasteContours(contoursJson: string, offsetX: number, offsetY: number): string {
    if (!this.#snapshot) {
      return JSON.stringify({
        success: false,
        createdPointIds: [],
        createdContourIds: [],
        error: "No active edit session",
      });
    }

    try {
      const contours = JSON.parse(contoursJson);
      const createdPointIds: string[] = [];
      const createdContourIds: string[] = [];

      for (const pasteContour of contours) {
        const contourId = this.#generateId();
        const newContour: MockContour = {
          id: contourId,
          closed: pasteContour.closed ?? false,
          points: pasteContour.points.map((p: any) => {
            const pointId = this.#generateId();
            createdPointIds.push(pointId);
            return {
              id: pointId,
              x: p.x + offsetX,
              y: p.y + offsetY,
              pointType: p.pointType,
              smooth: p.smooth ?? false,
            };
          }),
        };

        this.#snapshot.contours.push(newContour);
        createdContourIds.push(contourId);
      }

      return JSON.stringify({
        success: true,
        createdPointIds,
        createdContourIds,
        error: null,
      });
    } catch (e) {
      return JSON.stringify({
        success: false,
        createdPointIds: [],
        createdContourIds: [],
        error: `Failed to parse contours: ${e}`,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PRIVATE
  // ═══════════════════════════════════════════════════════════

  #makeResult(success: boolean, affectedPointIds: string[], error?: string): string {
    const result: CommandResult = {
      success,
      snapshot: this.#snapshot as unknown as GlyphSnapshot,
      error: error ?? null,
      affectedPointIds: affectedPointIds.length > 0 ? (affectedPointIds as PointId[]) : null,
      canUndo: false,
      canRedo: false,
    };
    return JSON.stringify(result);
  }
}

/**
 * Create a mock FontEngineAPI for testing.
 */
export function createMockNative(): FontEngineAPI {
  return new MockFontEngine();
}
