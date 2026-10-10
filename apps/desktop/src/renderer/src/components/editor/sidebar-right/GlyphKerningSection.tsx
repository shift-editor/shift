import { useSignalState } from "@shift/editor/signals";
import { KerningGroupField } from "@/components/kerning/KerningGroupField";
import { KerningGroupsPanel } from "@/components/kerning/groups/KerningGroupsPanel";
import { useEditor } from "@/workspace/WorkspaceContext";
import { SidebarSection, SidebarSubsection } from "./SidebarSection";

/**
 * The shown glyph's kerning groups, outside the Kerning tool: its left
 * edge's group on the left and its right edge's on the right, so a new or
 * redrawn glyph can be grouped without opening a pair, and the groups panel
 * to browse every group.
 *
 * @remarks
 * Renders nothing unless the scene holds exactly one glyph, as the Glyph
 * section above it does.
 */
interface GlyphKerningSectionProps {
  /** The sidebar block the section sits in, which the groups panel opens beside. */
  readonly anchorRef: React.RefObject<HTMLElement | null>;
}

export const GlyphKerningSection = ({ anchorRef }: GlyphKerningSectionProps) => {
  const editor = useEditor();
  const scene = useSignalState(editor.scene.cell);
  const glyphNodes = scene.nodes.filter((node) => node.kind === "glyph");
  const node = glyphNodes.length === 1 ? glyphNodes[0] : undefined;
  if (node?.kind !== "glyph") return null;

  const glyphId = node.glyphId;
  const glyphName = editor.font.entryForId(glyphId)?.name ?? glyphId;
  const disabled = editor.sessionMode !== "workspace";

  return (
    <SidebarSection
      title="Kerning"
      actions={<KerningGroupsPanel target={{ kind: "glyph", glyphId }} anchorRef={anchorRef} />}
    >
      <SidebarSubsection title="Groups">
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
      </SidebarSubsection>
    </SidebarSection>
  );
};
