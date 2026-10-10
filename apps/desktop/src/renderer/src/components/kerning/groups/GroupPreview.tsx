import { useEffect, useRef } from "react";
import type { KerningPairPosition } from "@shift/editor/model";
import { effect } from "@shift/editor/signals";
import type { GlyphId } from "@shift/types";
import { useEditor } from "@/workspace/WorkspaceContext";
import { drawGroupPreview, type MemberWord } from "./drawGroupPreview";
import type { MemberSelection } from "./MemberSelection";
import type { PreviewLayout } from "./PreviewLayout";
import { glyphName } from "./previewGlyphs";
import { useMemberDrag } from "./useMemberDrag";

interface GroupPreviewProps {
  readonly position: KerningPairPosition;
  readonly group: string;
  readonly otherGlyphId: GlyphId | null;
  readonly hovered: GlyphId | null;
  /** The selection, over the group's members in order. */
  readonly selection: MemberSelection;
  readonly onHover: (member: GlyphId | null) => void;
  readonly onSelect: (selection: MemberSelection) => void;
  /** Takes the selected members out of the group. */
  readonly onRemove: () => void;
}

/**
 * Every member set against the pair's other glyph, kerned as the font kerns
 * at the active source or location, so a member whose edge does not match
 * shows as a collision or a gap. It is also the member list: click to
 * select, Shift-click or drag for a range, ⌘-click to add or remove one;
 * the arrow keys move (Shift extends), ⌘A selects all, and Delete takes the
 * selection out of the group.
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
  const { members } = selection;
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

  const drag = useMemberDrag({
    containerRef,
    memberAt,
    onSweep: (anchor, member) => onSelect(selection.drag(anchor, member)),
  });

  return (
    <div
      data-keeps-member-selection=""
      ref={containerRef}
      tabIndex={0}
      role="group"
      aria-label={`Members of ${group}`}
      className="scrollbar-hidden max-h-44 overflow-y-auto rounded bg-input p-1 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
      onKeyDown={(event) => {
        const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
        const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
        if (forward || backward) {
          onSelect(selection.step(forward ? 1 : -1, event.shiftKey));
        } else if (event.key === "a" && (event.metaKey || event.ctrlKey)) {
          onSelect(selection.all());
        } else if ((event.key === "Delete" || event.key === "Backspace") && !selection.isEmpty) {
          onRemove();
        } else if (event.key === "Escape" && !selection.isEmpty) {
          onSelect(selection.clear());
        } else return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        title={hovered ? glyphName(editor, hovered) : undefined}
        className="block w-full cursor-pointer select-none text-primary"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const member = memberAt(event.clientX, event.clientY);
          const modifiers = { range: event.shiftKey, toggle: event.metaKey || event.ctrlKey };
          onSelect(selection.click(member, modifiers));
          // A drag from a plain press sweeps a range from where it started.
          if (!member || modifiers.range || modifiers.toggle) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.start(member, event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          onHover(memberAt(event.clientX, event.clientY));
          drag.move(event.clientX, event.clientY);
        }}
        onPointerUp={drag.end}
        onLostPointerCapture={drag.end}
        onPointerLeave={() => onHover(null)}
      />
    </div>
  );
}
