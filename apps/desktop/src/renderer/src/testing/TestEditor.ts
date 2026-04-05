/**
 * TestEditor — a real Editor with a mock NAPI backend for testing.
 *
 * Usage:
 *   const editor = new TestEditor();
 *   editor.startSession("A");
 *   editor.selectTool("pen");
 *   editor.click(100, 200);
 *   expect(editor.pointCount).toBe(1);
 */

import type { Point2D, PointId, Glyph, GlyphSnapshot } from "@shift/types";
import { Glyphs } from "@shift/font";
import { Editor } from "@/lib/editor/Editor";
import { FontEngine } from "@/engine/FontEngine";
import { MockFontEngine } from "@/engine/mock";
import type { ToolName } from "@/lib/tools/core";
import { makeTestCoordinates } from "./coordinates";

export class TestEditor extends Editor {
  readonly mockEngine: MockFontEngine;

  constructor() {
    const mock = new MockFontEngine();
    super({ fontEngine: new FontEngine(mock) });
    this.mockEngine = mock;
  }

  // ── Session ──

  startSession(glyphName = "A", unicode?: number): this {
    this.startEditSession({ glyphName, unicode: unicode ?? 65 });
    this.addContour();
    return this;
  }

  // ── Input simulation (fluent) ──

  click(x: number, y: number, options?: { shiftKey?: boolean; altKey?: boolean }): this {
    this.toolManager.handleEvent({
      type: "click",
      point: { x, y },
      coords: makeTestCoordinates({ x, y }),
      shiftKey: options?.shiftKey ?? false,
      altKey: options?.altKey ?? false,
      metaKey: false,
    });
    return this;
  }

  pointerMove(x: number, y: number): this {
    this.toolManager.handleEvent({
      type: "pointerMove",
      point: { x, y },
      coords: makeTestCoordinates({ x, y }),
    });
    return this;
  }

  pointerDown(x: number, y: number, options?: { shiftKey?: boolean; altKey?: boolean }): this {
    this.toolManager.handleEvent({
      type: "dragStart",
      point: { x, y },
      coords: makeTestCoordinates({ x, y }),
      screenPoint: { x, y },
      shiftKey: options?.shiftKey ?? false,
      altKey: options?.altKey ?? false,
      metaKey: false,
    });
    return this;
  }

  drag(x: number, y: number, options?: { shiftKey?: boolean; altKey?: boolean }): this {
    this.toolManager.handleEvent({
      type: "drag",
      point: { x, y },
      coords: makeTestCoordinates({ x, y }),
      screenPoint: { x, y },
      origin: { x: 0, y: 0 },
      screenOrigin: { x: 0, y: 0 },
      delta: { x, y },
      screenDelta: { x, y },
      shiftKey: options?.shiftKey ?? false,
      altKey: options?.altKey ?? false,
      metaKey: false,
    });
    return this;
  }

  pointerUp(x: number, y: number): this {
    this.toolManager.handleEvent({
      type: "dragEnd",
      point: { x, y },
      coords: makeTestCoordinates({ x, y }),
      screenPoint: { x, y },
      origin: { x: 0, y: 0 },
      screenOrigin: { x: 0, y: 0 },
    });
    return this;
  }

  keyDown(key: string, options?: { shiftKey?: boolean; altKey?: boolean }): this {
    this.toolManager.handleEvent({
      type: "keyDown",
      key,
      shiftKey: options?.shiftKey ?? false,
      altKey: options?.altKey ?? false,
      metaKey: false,
    });
    return this;
  }

  escape(): this {
    return this.keyDown("Escape");
  }

  // ── Tool ──

  selectTool(name: ToolName): this {
    this.setActiveTool(name);
    return this;
  }

  // ── Queries ──

  get snapshot(): GlyphSnapshot | null {
    return this.fontEngine.$glyph.peek();
  }

  get currentGlyph(): Glyph | null {
    return this.glyph.peek();
  }

  get pointCount(): number {
    const glyph = this.currentGlyph;
    if (!glyph) return 0;
    return Glyphs.getAllPoints(glyph).length;
  }

  getPointPosition(pointId: PointId): Point2D | null {
    const glyph = this.currentGlyph;
    if (!glyph) return null;

    const found = Glyphs.findPoint(glyph, pointId);
    if (!found) return null;

    return { x: found.point.x, y: found.point.y };
  }
}
