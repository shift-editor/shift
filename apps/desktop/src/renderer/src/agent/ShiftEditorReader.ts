import type { EditorView } from "@shift/runtime";
import type { Editor } from "@shift/editor";
import type { Signal } from "@shift/editor/signals";
import type { WorkspaceApplyStatus } from "@/types/workspace";

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
}
