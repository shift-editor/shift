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
import { ObjectSectionRow } from "./object-tree/ObjectSectionRow";

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
      <AxesSection defaultOpen />
      <Separator className="-mx-1 w-auto" />
      <SourcesSection
        defaultOpen
        section={ObjectSectionRow}
        outlineControls={outlines.sourceControls}
      />
      <Separator className="-mx-1 w-auto" />
      <InstancesSection
        defaultOpen
        section={ObjectSectionRow}
        outlineControls={outlines.instanceControls}
      />
    </div>
  );
};
