import type { Editor } from "@shift/editor";
import type { LocalPoint, ScenePoint, ScreenPoint } from "@shift/editor/spaces";
import type { Point2D } from "@shift/geo";
import {
  ascending,
  comparing,
  type GlyphId,
  type NodeId,
  type PointId,
  type SourceId,
  type Unicode,
} from "@shift/types";

/** The glyph being edited and its authored layer's size. */
export interface EditedGlyph {
  readonly glyphId: GlyphId;
  readonly nodeId: NodeId;
  readonly sourceId: SourceId;
  readonly pointCount: number;
  readonly contourCount: number;
}

/** One point's position in glyph units, on the canvas, and on the page. */
export interface PointProjection {
  readonly id: PointId;
  readonly glyphPosition: Point2D;
  readonly canvasPosition: Point2D;
  readonly pagePosition: Point2D;
}

/** A drag of one visible point: where it starts and ends on the page, and where the point lands. */
export interface VisiblePointDrag {
  readonly id: PointId;
  readonly startPagePosition: Point2D;
  readonly endPagePosition: Point2D;
  readonly expectedGlyphPosition: Point2D;
}

/** Selection bounds in glyph units. */
export interface GlyphBounds {
  readonly min: Point2D;
  readonly max: Point2D;
}

/**
 * Editor and canvas state the E2E driver reads but agents do not: the camera,
 * projections between glyph, scene and canvas, hover, tool state, and live
 * gesture previews.
 *
 * @remarks
 * Served through the E2E hook for test launches only. Every position on the
 * canvas or page is computed here, from the editor's own camera, never in a spec.
 */
export class EditorProbes {
  readonly #editor: Editor;

  constructor(editor: Editor) {
    this.#editor = editor;
  }

  /** Whether the glyph `glyphId` is open on the canvas with its layer published. */
  glyphOpen(glyphId: GlyphId): boolean {
    const editor = this.#editor;
    const node = editor.scene.first("glyph");
    if (!node || node.glyphId !== glyphId) return false;

    return Boolean(editor.glyphForId(node.glyphId)?.layerForSource(node.sourceId));
  }

  /** The glyph the scene shows on the canvas, or null when it shows none. */
  shownGlyphId(): GlyphId | null {
    return this.#editor.scene.first("glyph")?.glyphId ?? null;
  }

  /** The glyph the font maps `codepoint` to, or null until the font has it. */
  glyphForUnicode(codepoint: number): GlyphId | null {
    const font = this.#editor.font;
    const handle = font.glyphHandleForUnicode(codepoint as Unicode);
    return font.recordForName(handle.name)?.id ?? null;
  }

  /** A scene position on the canvas, in canvas-local pixels. */
  sceneToCanvas(position: Point2D): Point2D {
    return this.#editor.sceneToScreen(position as ScenePoint);
  }

  /** A canvas-local position in the scene. */
  canvasToScene(position: Point2D): Point2D {
    return this.#editor.screenToScene(position as ScreenPoint);
  }

  /** A position in the open glyph's units on the canvas, in canvas-local pixels. */
  glyphToCanvas(position: Point2D): Point2D {
    const editor = this.#editor;
    const node = editor.scene.first("glyph");
    if (!node) throw new Error("Expected an open glyph node");

    return editor.sceneToScreen(editor.toScene(node, position as LocalPoint));
  }

  /** The glyph being edited, or null when none is (or its authored layer is not published). */
  editedGlyph(): EditedGlyph | null {
    const editor = this.#editor;
    const editingId = editor.editing.nodeIds[0] ?? null;
    const node = editor.scene.nodeOfKind(editingId, "glyph");
    if (!node) return null;

    const layer = editor.glyphForId(node.glyphId)?.layerForSource(node.sourceId);
    if (!layer) return null;

    return {
      glyphId: node.glyphId,
      nodeId: node.id,
      sourceId: node.sourceId,
      pointCount: layer.pointCount,
      contourCount: layer.contours.length,
    };
  }

  /** The canvas zoom level. */
  zoom(): number {
    return this.#editor.zoom;
  }

  /** How far the canvas is panned, in screen pixels. */
  pan(): Point2D {
    const { x, y } = this.#editor.pan;
    return { x, y };
  }

  /** The ids of the scene nodes being edited, in the order they were entered. */
  editedNodeIds(): string[] {
    return [...this.#editor.editing.nodeIds];
  }

  /** The hovered editor object, or null when nothing is hovered. */
  hoverId(): string | null {
    return this.#editor.hover.id ?? null;
  }

  /** The active tool's published state discriminator, or null without an active tool. */
  toolState(): string | null {
    return this.#editor.toolManager.activeTool?.getState().type ?? null;
  }

  /** The live selection's bounds in glyph units, or null without a bounded selection. */
  selectionBounds(): GlyphBounds | null {
    const bounds = this.#editor.selectionBounds();
    if (!bounds) return null;
    return { min: { ...bounds.min }, max: { ...bounds.max } };
  }

  /** Where each point is in glyph units, on the canvas and on the page; throws when one is absent. */
  pointProjections(ids: readonly PointId[]): PointProjection[] {
    const editor = this.#editor;
    const node = editor.scene.first("glyph");
    const layer = node ? editor.glyphForId(node.glyphId)?.layerForSource(node.sourceId) : null;
    const canvas = document.querySelector<HTMLCanvasElement>("#interactive-canvas");
    if (!node || !layer || !canvas) throw new Error("Expected editable glyph");

    const bounds = canvas.getBoundingClientRect();
    return ids.map((id) => {
      const point = layer.point(id);
      if (!point) throw new Error(`Expected editable point ${id}`);

      const canvasPosition = editor.sceneToScreen(
        editor.toScene(node, { x: point.x, y: point.y } as LocalPoint),
      );
      return {
        id,
        glyphPosition: { x: point.x, y: point.y },
        canvasPosition,
        pagePosition: { x: bounds.left + canvasPosition.x, y: bounds.top + canvasPosition.y },
      };
    });
  }

  /** Where a point is now, the preview of a gesture in flight included; throws when absent. */
  livePointPosition(id: PointId): Point2D {
    const editor = this.#editor;
    const node = editor.scene.first("glyph");
    const point = node
      ? editor
          .glyphForId(node.glyphId)
          ?.layerForSource(node.sourceId)
          ?.allPoints.find((candidate) => candidate.id === id)
      : null;
    if (!point) throw new Error("Expected editable point");

    return { x: point.x, y: point.y };
  }

  /**
   * A drag of the on-curve point nearest the canvas centre that sits well inside the canvas,
   * 40 by 30 pixels down and right; throws when no point is visible.
   */
  visiblePointDrag(): VisiblePointDrag {
    const editor = this.#editor;
    const canvas = document.querySelector<HTMLCanvasElement>("#interactive-canvas");
    const node = editor.scene.first("glyph");
    const layer = node ? editor.glyphForId(node.glyphId)?.layerForSource(node.sourceId) : null;
    if (!canvas || !node || !layer) throw new Error("Expected editable glyph");

    const bounds = canvas.getBoundingClientRect();
    const centre = { x: bounds.width / 2, y: bounds.height / 2 };
    const distanceToCentre = (screen: Point2D) =>
      Math.hypot(screen.x - centre.x, screen.y - centre.y);
    const candidates = layer.allPoints
      .filter((candidate) => candidate.isOnCurve)
      .map((candidate) => ({
        point: candidate,
        screen: editor.sceneToScreen(
          editor.toScene(node, { x: candidate.x, y: candidate.y } as LocalPoint),
        ),
      }))
      .filter(
        ({ screen }) =>
          screen.x >= 50 &&
          screen.y >= 50 &&
          screen.x <= bounds.width - 100 &&
          screen.y <= bounds.height - 100,
      )
      .sort(comparing(({ screen }) => distanceToCentre(screen), ascending));
    const candidate = candidates[0];
    if (!candidate) throw new Error("Expected visible on-curve point");

    const endScreen = { x: candidate.screen.x + 40, y: candidate.screen.y + 30 };
    const endScene = editor.screenToScene(endScreen as ScreenPoint);
    return {
      id: candidate.point.id,
      startPagePosition: {
        x: bounds.left + candidate.screen.x,
        y: bounds.top + candidate.screen.y,
      },
      endPagePosition: { x: bounds.left + endScreen.x, y: bounds.top + endScreen.y },
      expectedGlyphPosition: editor.toLocal(node, endScene),
    };
  }

  /** The first unselected on-curve point and its page position; throws when none exists. */
  unselectedPoint(): { id: PointId; x: number; y: number } {
    const editor = this.#editor;
    const canvas = document.querySelector<HTMLCanvasElement>("#interactive-canvas");
    const node = editor.scene.first("glyph");
    const layer = node ? editor.glyphForId(node.glyphId)?.layerForSource(node.sourceId) : null;
    if (!canvas || !node || !layer) throw new Error("Expected editable glyph");

    const point = layer.allPoints.find(
      (candidate) => candidate.isOnCurve && !editor.selection.has(candidate.id),
    );
    if (!point) throw new Error("Expected unselected point");

    const screen = editor.sceneToScreen(
      editor.toScene(node, { x: point.x, y: point.y } as LocalPoint),
    );
    const bounds = canvas.getBoundingClientRect();
    return { id: point.id, x: bounds.left + screen.x, y: bounds.top + screen.y };
  }
}
