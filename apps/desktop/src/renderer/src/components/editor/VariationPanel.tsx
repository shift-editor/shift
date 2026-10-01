import { Separator } from "@shift/ui";
import { AxesSection } from "@/components/variation/AxesSection";
import { InstancesSection } from "@/components/variation/InstancesSection";
import { SourcesSection } from "@/components/variation/SourcesSection";
import { useSignalState } from "@shift/editor/signals";
import { useActiveSourceId } from "@/hooks/useActiveSourceId";
import { useEditingSourceIds } from "@/hooks/useEditingSourceIds";
import { useGlyphOutlineTargets } from "@/hooks/useGlyphOutlineTargets";
import { useVariationOutlineControls } from "@/hooks/useVariationOutlineControls";
import { useEditor } from "@/workspace/WorkspaceContext";

export const VariationPanel = () => {
  const editor = useEditor();
  const scene = useSignalState(editor.scene.cell);
  const glyphNodeId = scene.nodes.find((node) => node.kind === "glyph")?.id ?? null;
  const activeSourceId = useActiveSourceId();
  const editingSourceIds = useEditingSourceIds();
  const outlines = useVariationOutlineControls(activeSourceId, editingSourceIds);
  useGlyphOutlineTargets(glyphNodeId, outlines.targets);

  return (
    <div className="flex flex-col gap-2 pt-2">
      <SourcesSection defaultOpen outlineControls={outlines.sourceControls} />
      <Separator />
      <InstancesSection defaultOpen outlineControls={outlines.instanceControls} />
      <Separator />
      <AxesSection defaultOpen />
    </div>
  );
};
