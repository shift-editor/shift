import { useRef } from "react";
import { useSignalState } from "@shift/editor/signals";
import { KerningGroupField } from "@/components/kerning/KerningGroupField";
import { KerningGroupsPanel } from "@/components/kerning/groups/KerningGroupsPanel";
import { KerningGroupsTarget } from "@/lib/kerning/KerningGroupsTarget";
import { useEditor } from "@/workspace/WorkspaceContext";

/**
 * The shown glyph's kerning groups, in the Glyph section beside its other
 * metrics: its left edge's group on the left and its right edge's on the
 * right, so a new or redrawn glyph can be grouped without opening a pair,
 * and the groups panel to browse every group.
 *
 * @remarks
 * Renders nothing unless the scene holds exactly one glyph, as the Glyph
 * section's metrics do.
 */
export const GlyphKerningGroups = () => {
  const editor = useEditor();
  const node = useSignalState(editor.scene.onlyCell("glyph"));
  // The groups panel opens beside these rows; they span the sidebar so it sits flush against it.
  const rowsRef = useRef<HTMLDivElement>(null);
  if (!node) return null;

  const glyphId = node.glyphId;
  const glyphName = editor.font.glyphName(glyphId) ?? glyphId;
  const disabled = editor.sessionMode !== "workspace";

  return (
    <div ref={rowsRef} className="-mx-3 mt-1 flex flex-col gap-2 px-3">
      <div className="flex h-6 items-center justify-between">
        <h3 className="text-ui font-medium text-primary">Kerning</h3>
        <KerningGroupsPanel target={KerningGroupsTarget.glyph(glyphId)} anchorRef={rowsRef} />
      </div>
      <div className="flex gap-2">
        {/* A glyph's left edge kerns as the second of a pair; its right edge as the first. */}
        <div className="min-w-0 flex-1">
          <KerningGroupField
            position="second"
            glyphId={glyphId}
            glyphName={glyphName}
            ariaLabel={`Left kerning group of ${glyphName}`}
            disabled={disabled}
          />
        </div>
        <div className="min-w-0 flex-1">
          <KerningGroupField
            position="first"
            glyphId={glyphId}
            glyphName={glyphName}
            ariaLabel={`Right kerning group of ${glyphName}`}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
};
