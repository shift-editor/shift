import type { DragEvent, ReactNode } from "react";
import type { Editor } from "@shift/editor";
import { asGlyphId } from "@shift/types";
import { GLYPH_DRAG_TYPE, insertGlyphIntoText } from "@/lib/glyph-grid/insertGlyph";

interface GlyphDropTargetProps {
  readonly editor: Editor;
  readonly children: ReactNode;
}

/** Lets a glyph tile dragged from the Glyphs tab be dropped on the canvas, which adds the glyph to the page's text. */
export function GlyphDropTarget({ editor, children }: GlyphDropTargetProps) {
  const carriesGlyph = (event: DragEvent) => event.dataTransfer.types.includes(GLYPH_DRAG_TYPE);
  const drop = async (glyphId: string) => {
    try {
      const id = asGlyphId(glyphId);
      await editor.font.loadGlyphs([id]);
      insertGlyphIntoText(editor, id);
    } catch (error) {
      console.error("could not insert the dropped glyph", glyphId, error);
    }
  };

  return (
    <div
      className="h-full"
      onDragOver={(event) => {
        if (!carriesGlyph(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        if (!carriesGlyph(event)) return;
        event.preventDefault();
        void drop(event.dataTransfer.getData(GLYPH_DRAG_TYPE));
      }}
    >
      {children}
    </div>
  );
}
