import { useEffect, useMemo, useState } from "react";
import { Separator } from "@shift/ui";
import { AxesSection } from "@/components/variation/AxesSection";
import { InstancesSection } from "@/components/variation/InstancesSection";
import { SourcesSection } from "@/components/variation/SourcesSection";
import { useSignalState } from "@/lib/signals";
import { useActiveSourceId } from "@/hooks/useActiveSourceId";
import { useEditingSourceIds } from "@/hooks/useEditingSourceIds";
import type { GlyphOutlineTarget } from "@/types/glyphOutline";
import { useEditor } from "@/workspace/WorkspaceContext";

export const LeftSidebar = () => {
  const editor = useEditor();
  const scene = useSignalState(editor.scene.cell);
  const glyphNodeId = scene.nodes.find((node) => node.kind === "glyph")?.id ?? null;
  const glyphDefinition = editor.nodeDefinition("glyph");
  const activeSourceId = useActiveSourceId();
  const editingSourceIds = useEditingSourceIds();
  const [visibleSourceOutlines, setVisibleSourceOutlines] = useState<readonly GlyphOutlineTarget[]>(
    [],
  );
  const [visibleInstanceOutlines, setVisibleInstanceOutlines] = useState<
    readonly GlyphOutlineTarget[]
  >([]);
  const sourceOutlineControls = useMemo(
    () => ({ targets: visibleSourceOutlines, onChange: setVisibleSourceOutlines }),
    [visibleSourceOutlines],
  );
  const instanceOutlineControls = useMemo(
    () => ({ targets: visibleInstanceOutlines, onChange: setVisibleInstanceOutlines }),
    [visibleInstanceOutlines],
  );
  const visibleOutlines = useMemo(() => {
    const editingSourceOutlineIds = new Set(
      Array.from(editingSourceIds).filter((sourceId) => sourceId !== activeSourceId),
    );
    const editingSourceOutlines = Array.from(editingSourceOutlineIds).map(
      (sourceId): GlyphOutlineTarget => ({ kind: "source", sourceId }),
    );

    return [
      ...editingSourceOutlines,
      ...visibleSourceOutlines.filter(
        (target) => target.kind !== "source" || !editingSourceOutlineIds.has(target.sourceId),
      ),
      ...visibleInstanceOutlines,
    ];
  }, [activeSourceId, editingSourceIds, visibleInstanceOutlines, visibleSourceOutlines]);

  useEffect(() => {
    if (!glyphNodeId) return;

    glyphDefinition.outlines.set(glyphNodeId, visibleOutlines);
  }, [glyphDefinition, glyphNodeId, visibleOutlines]);

  useEffect(() => {
    if (!glyphNodeId) return;

    return () => glyphDefinition.outlines.clear(glyphNodeId);
  }, [glyphDefinition, glyphNodeId]);

  return (
    <aside
      aria-label="Variation controls"
      className="h-full w-full min-w-0 bg-panel border-r border-line-subtle flex flex-col overflow-hidden"
    >
      <div className="px-1 py-3 flex flex-col gap-2">
        <SourcesSection defaultOpen outlineControls={sourceOutlineControls} />
        <Separator />
        <InstancesSection defaultOpen outlineControls={instanceOutlineControls} />
        <Separator />
        <AxesSection defaultOpen />
      </div>
    </aside>
  );
};
