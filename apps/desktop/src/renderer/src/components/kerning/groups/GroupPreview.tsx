import { useEffect, useRef } from "react";
import type { KerningPairPosition } from "@shift/editor/model";
import { effect } from "@shift/editor/signals";
import type { GlyphId } from "@shift/types";
import { useEditor } from "@/workspace/WorkspaceContext";
import { drawGroupPreview, type MemberWord } from "./drawGroupPreview";
import type { GlyphSelection } from "../../glyph-grid/GlyphSelection";
import { copyGlyphNames } from "../../glyph-grid/glyphNames";
import { useGlyphSelection } from "../../glyph-grid/useGlyphSelection";
import type { PreviewLayout } from "./PreviewLayout";
import { glyphName } from "./previewGlyphs";

interface GroupPreviewProps {
  readonly position: KerningPairPosition;
  readonly group: string;
  readonly otherGlyphId: GlyphId | null;
  readonly hovered: GlyphId | null;
  /** The selection, over the group's members in order. */
  readonly selection: GlyphSelection;
  readonly onHover: (member: GlyphId | null) => void;
  readonly onSelect: (selection: GlyphSelection) => void;
  /** Takes the selected members out of the group. */
  readonly onRemove: () => void;
}

/**
 * Every member set against the pair's other glyph, kerned as the font kerns
 * at the active source or location, so a member whose edge does not match
 * shows as a collision or a gap. It is also the member list: click to
 * select, Shift-click or drag for a range, ⌘-click to add or remove one;
 * the arrow keys move (Shift extends), ⌘A selects all, ⌘C copies the
 * selection's names, and Delete takes it out of the group.
 */
export function GroupPreview({
  position,
  group,
  otherGlyphId,
  hovered,
  selection,
  onHover,
  onSelect,
  onRemove,
}: GroupPreviewProps) {
  const editor = useEditor();
  const { glyphs: members } = selection;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // non-reactive: the last drawn layout, read only by pointer handlers.
  const layoutRef = useRef<PreviewLayout<MemberWord> | null>(null);

  useEffect(() => {
    const glyphIds = otherGlyphId ? [otherGlyphId, ...members] : members;
    editor.font.loadGlyphs(glyphIds).catch((error: unknown) => {
      console.error("failed to load kerning group preview glyphs", error);
    });
  }, [editor, members, otherGlyphId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const subscription = effect(() => {
      layoutRef.current = drawGroupPreview(
        canvas,
        editor,
        { position, members, other: otherGlyphId },
        { hovered, selection },
      );
    });
    return () => subscription.dispose();
  }, [editor, hovered, members, otherGlyphId, position, selection]);

  const memberAt = (clientX: number, clientY: number): GlyphId | null => {
    const canvas = canvasRef.current;
    const layout = layoutRef.current;
    if (!canvas || !layout) return null;
    const rect = canvas.getBoundingClientRect();
    return layout.memberAt(clientX - rect.left, clientY - rect.top);
  };

  const select = useGlyphSelection({
    selection,
    onSelect,
    containerRef,
    glyphAt: memberAt,
    onRemove,
    onCopy: () => void copyGlyphNames(editor, selection.ids),
  });

  return (
    <div
      data-keeps-member-selection=""
      ref={containerRef}
      tabIndex={0}
      role="group"
      aria-label={`Members of ${group}`}
      className="scrollbar-hidden max-h-44 overflow-y-auto rounded bg-input p-1 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
      onKeyDown={select.onKeyDown}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        title={hovered ? glyphName(editor, hovered) : undefined}
        className="block w-full cursor-pointer select-none text-primary"
        onPointerDown={select.onPointerDown}
        onPointerMove={(event) => {
          onHover(memberAt(event.clientX, event.clientY));
          select.onPointerMove(event);
        }}
        onPointerUp={select.onPointerUp}
        onLostPointerCapture={select.onLostPointerCapture}
        onPointerLeave={() => onHover(null)}
      />
    </div>
  );
}
