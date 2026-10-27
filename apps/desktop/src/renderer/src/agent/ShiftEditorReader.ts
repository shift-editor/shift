import type { AuthoredContour, EditorView } from "@shift/runtime";
import type { Editor } from "@shift/editor";
import type { GlyphOutlineTarget, PositionGuide } from "@shift/editor/types";
import type { PointId } from "@shift/types";
import type { Signal } from "@shift/editor/signals";
import type { WorkspaceApplyStatus } from "@/types/workspace";

/** One point handle the canvas draws, and how it is styled. */
export interface DrawnHandle {
  pointId: PointId;
  /** `interpolated` between sources, where handles show no selection or hover. */
  state: "idle" | "hovered" | "selected" | "interpolated";
}

/**
 * Public reads of one editor's view: its open glyph, sources, location,
 * selection, tool and edit state.
 *
 * @remarks
 * Returns runtime DTOs. Revision guarding and transport belong to the caller.
 */
export class ShiftEditorReader {
  readonly #editor: Editor;
  readonly #applyStatusCell: Signal<WorkspaceApplyStatus> | null;

  /**
   * @param applyStatusCell - The workspace's apply status; null for a session
   * without a workspace (a preview or an in-memory font).
   */
  constructor(editor: Editor, applyStatusCell: Signal<WorkspaceApplyStatus> | null) {
    this.#editor = editor;
    this.#applyStatusCell = applyStatusCell;
  }

  /**
   * @param route - The window's route, which only the window knows.
   */
  inspect(route: string): EditorView {
    const editor = this.#editor;
    const node = editor.scene.first("glyph");
    const entry = node ? editor.font.entryForId(node.glyphId) : null;
    const glyph =
      node && entry
        ? {
            glyphId: node.glyphId,
            name: entry.name,
            nodeId: node.id,
            sourceId: node.sourceId,
          }
        : null;
    const tool = editor.tool;

    return {
      route,
      glyph,
      activeSourceId: editor.activeSourceId,
      editingSourceIds: [...editor.editingSourceIds],
      externalLocation: [...editor.externalLocation].map(([axisId, value]) => ({ axisId, value })),
      selectionIds: [...editor.selection.ids],
      tool: tool ? { id: tool.id, state: tool.state.type } : null,
      dragging: editor.isDragging,
      editing: editor.isEditing,
      applyStatus: this.#applyStatusCell?.peek() ?? null,
    };
  }

  /**
   * The open glyph's outline as the canvas draws it now, the uncommitted
   * preview of a gesture in flight included.
   *
   * @returns the active source's contours; empty when no glyph is open or no
   * source is active.
   */
  drawnOutline(): AuthoredContour[] {
    const editor = this.#editor;
    const node = editor.scene.first("glyph");
    const sourceId = editor.activeSourceId;
    if (!node || !sourceId) return [];

    const layer = editor.layerForGlyph(node.glyphId, sourceId);
    if (!layer) return [];

    return layer.contours.map((contour) => ({
      id: contour.id,
      closed: contour.closed,
      points: contour.points.map(({ id, x, y, pointType, smooth }) => ({
        id,
        x,
        y,
        pointType,
        smooth,
      })),
    }));
  }

  /**
   * The point handles the canvas draws on the open glyph, in outline order.
   * Handles hidden while a gesture owns their contour are left out.
   */
  drawnHandles(): DrawnHandle[] {
    const editor = this.#editor;
    const node = editor.scene.first("glyph");
    if (!node) return [];

    const states = editor.nodeDefinition("glyph").handleStates(node);
    return [...states].map(([pointId, state]) => ({ pointId, state }));
  }

  /** The source and instance outlines the canvas draws around the open glyph, in drawing order. */
  drawnOutlineTargets(): GlyphOutlineTarget[] {
    const editor = this.#editor;
    const node = editor.scene.first("glyph");
    if (!node) return [];

    return [...editor.nodeDefinition("glyph").visibleOutlines(node.id)];
  }

  /**
   * The snap guides the active tool draws for the gesture in flight, in glyph
   * units; empty when nothing snaps or no gesture is in flight.
   */
  drawnSnapGuides(): PositionGuide[] {
    const pen = this.#editor.toolIf("pen")?.state;
    if (pen) {
      switch (pen.type) {
        case "closing":
        case "pulling":
        case "dragging":
          return [...pen.guides];
        default:
          return [];
      }
    }

    const select = this.#editor.toolIf("select")?.state;
    if (select?.type === "translating") return [...select.translate.guides];
    return [];
  }
}
