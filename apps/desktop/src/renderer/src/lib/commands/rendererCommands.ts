import type { RendererCommandId } from "@shared/commands";
import type { ContourId } from "@shift/types";
import type { Editor } from "@/lib/editor/Editor";
import { objectIsKindOf } from "@/types";

/**
 * Executes a renderer-owned app command against one editor.
 *
 * @param editor - Editor whose current selection and document state supply command context.
 * @param id - Shared command identity requested by native shell or renderer UI.
 * @returns true when the command mutates or handles current state.
 */
export function runRendererCommand(editor: Editor, id: RendererCommandId): boolean {
  switch (id) {
    case "glyph.reverseSelectedContour": {
      const contourIds = new Set<ContourId>();

      for (const object of editor.objects(editor.selection.ids)) {
        switch (object.kind) {
          case "point":
          case "segment":
          case "contour":
            contourIds.add(object.contourId);
            break;

          case "anchor":
          case "node":
            break;
        }
      }

      const contours = [...contourIds]
        .map((contourId) => editor.object(contourId))
        .filter((object) => objectIsKindOf(object, "contour"));

      if (contours.length === 0) return false;

      editor.transaction("Reverse Contours", () => {
        for (const contour of contours) {
          contour.layer.reverseContour(contour.contourId);
        }
      });

      return true;
    }
  }
}
