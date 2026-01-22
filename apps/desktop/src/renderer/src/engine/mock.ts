/**
 * MockFontEngine - In-memory implementation for testing.
 *
 * Implements the FontEngineAPI interface without requiring
 * the Rust backend or Electron context.
 */

import type {
  FontEngineAPI,
  JsFontMetaData,
  JsFontMetrics,
  JsGlyphSnapshot,
} from "@shared/bridge/FontEngineAPI";
import type { PointTypeString, CommandResult } from "@/types/generated";

/**
 * Mock implementation of FontEngineAPI for testing.
 */
export class MockFontEngine implements FontEngineAPI {
  #snapshot: JsGlyphSnapshot | null = null;
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

  // ═══════════════════════════════════════════════════════════
  // FONT INFO
  // ═══════════════════════════════════════════════════════════

  getMetadata(): JsFontMetaData {
    return {
      family: "Mock Font",
      styleName: "Regular",
      versionMajor: 1,
      versionMinor: 0,
    };
  }

  getMetrics(): JsFontMetrics {
    return {
      unitsPerEm: 1000,
      ascender: 800,
      descender: -200,
      capHeight: 700,
      xHeight: 500,
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

  getSnapshot(): string | null {
    if (!this.#snapshot) return null;
    return JSON.stringify(this.#snapshot);
  }

  getSnapshotData(): JsGlyphSnapshot {
    if (!this.#snapshot) {
      throw new Error("No active edit session");
    }
    return this.#snapshot;
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
    if (!this.#snapshot)
      return this.#makeResult(false, [], "No active edit session");

    const activeContour = this.#snapshot.contours.find(
      (c) => c.id === this.#snapshot!.activeContourId,
    );
    if (activeContour) {
      activeContour.closed = true;
    }

    return this.#makeResult(true, []);
  }

  setActiveContour(contourId: string): string {
    if (!this.#snapshot)
      return this.#makeResult(false, [], "No active edit session");

    const contour = this.#snapshot.contours.find((c) => c.id === contourId);
    if (!contour) {
      return this.#makeResult(false, [], `Contour ${contourId} not found`);
    }

    this.#snapshot.activeContourId = contourId;
    return this.#makeResult(true, []);
  }

  reverseContour(contourId: string): string {
    if (!this.#snapshot)
      return this.#makeResult(false, [], "No active edit session");

    const contour = this.#snapshot.contours.find((c) => c.id === contourId);
    if (!contour) {
      return this.#makeResult(false, [], `Contour ${contourId} not found`);
    }

    contour.points.reverse();
    return this.#makeResult(true, []);
  }

  removeContour(contourId: string): string {
    if (!this.#snapshot)
      return this.#makeResult(false, [], "No active edit session");

    const index = this.#snapshot.contours.findIndex((c) => c.id === contourId);
    if (index === -1) {
      return this.#makeResult(false, [], `Contour ${contourId} not found`);
    }

    this.#snapshot.contours.splice(index, 1);

    if (this.#snapshot.activeContourId === contourId) {
      this.#snapshot.activeContourId =
        this.#snapshot.contours.length > 0
          ? this.#snapshot.contours[0].id
          : null;
    }

    return this.#makeResult(true, []);
  }

  // ═══════════════════════════════════════════════════════════
  // POINT OPERATIONS
  // ═══════════════════════════════════════════════════════════

  addPoint(
    x: number,
    y: number,
    pointType: PointTypeString,
    smooth: boolean,
  ): string {
    if (!this.#snapshot)
      return this.#makeResult(false, [], "No active edit session");

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
    activeContour.points.push({
      id: pointId,
      x,
      y,
      pointType,
      smooth,
    });

    return this.#makeResult(true, [pointId]);
  }

  addPointToContour(
    contourId: string,
    x: number,
    y: number,
    pointType: PointTypeString,
    smooth: boolean,
  ): string {
    if (!this.#snapshot)
      return this.#makeResult(false, [], "No active edit session");

    const contour = this.#snapshot.contours.find((c) => c.id === contourId);
    if (!contour) {
      return this.#makeResult(false, [], `Contour ${contourId} not found`);
    }

    const pointId = this.#generateId();
    contour.points.push({
      id: pointId,
      x,
      y,
      pointType,
      smooth,
    });

    return this.#makeResult(true, [pointId]);
  }

  movePoints(pointIds: string[], dx: number, dy: number): string {
    if (!this.#snapshot)
      return this.#makeResult(false, [], "No active edit session");

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
    if (!this.#snapshot)
      return this.#makeResult(false, [], "No active edit session");

    for (const contour of this.#snapshot.contours) {
      contour.points = contour.points.filter((p) => !pointIds.includes(p.id));
    }

    return this.#makeResult(true, pointIds);
  }

  insertPointBefore(
    beforePointId: string,
    x: number,
    y: number,
    pointType: PointTypeString,
    smooth: boolean,
  ): string {
    if (!this.#snapshot)
      return this.#makeResult(false, [], "No active edit session");

    // Find the contour and index of the reference point
    for (const contour of this.#snapshot.contours) {
      const index = contour.points.findIndex((p) => p.id === beforePointId);
      if (index !== -1) {
        const newPointId = this.#generateId();
        const newPoint = {
          id: newPointId,
          x,
          y,
          pointType,
          smooth,
        };
        // Insert at the found index (before the reference point)
        contour.points.splice(index, 0, newPoint);
        return this.#makeResult(true, [newPointId]);
      }
    }

    return this.#makeResult(false, [], `Point ${beforePointId} not found`);
  }

  toggleSmooth(pointId: string): string {
    if (!this.#snapshot)
      return this.#makeResult(false, [], "No active edit session");

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
  // UNIFIED EDIT OPERATION
  // ═══════════════════════════════════════════════════════════

  applyEditsUnified(pointIds: string[], dx: number, dy: number): string {
    if (!this.#snapshot) {
      return JSON.stringify({
        success: false,
        snapshot: null,
        affectedPointIds: [],
        matchedRules: [],
        error: "No active edit session",
      });
    }

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

    return JSON.stringify({
      success: true,
      snapshot: this.#snapshot,
      affectedPointIds: moved,
      matchedRules: [],
      error: null,
    });
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
        const newContour = {
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

  #makeResult(
    success: boolean,
    affectedPointIds: string[],
    error?: string,
  ): string {
    const result: CommandResult = {
      success,
      snapshot: this.#snapshot as any, // Type coercion for mock
      error: error ?? null,
      affectedPointIds: affectedPointIds.length > 0 ? affectedPointIds : null,
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
