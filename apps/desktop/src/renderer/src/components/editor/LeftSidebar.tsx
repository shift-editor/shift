import { useEffect, useMemo, useState } from "react";
import { Separator } from "@shift/ui";
import { AxesSection } from "@/components/variation/AxesSection";
import { InstancesSection } from "@/components/variation/InstancesSection";
import { SourcesSection } from "@/components/variation/SourcesSection";
import { useSignalState } from "@/lib/signals";
import type { GlyphOutlineTarget } from "@/types/glyphOutline";
import { useEditor } from "@/workspace/WorkspaceContext";

export const LeftSidebar = () => {
  const editor = useEditor();
  const scene = useSignalState(editor.scene.cell);
  const glyphNodeId = scene.nodes.find((node) => node.kind === "glyph")?.id ?? null;
  const glyphDefinition = editor.nodeDefinition("glyph");
  const [visibleOutlines, setVisibleOutlines] = useState<readonly GlyphOutlineTarget[]>([]);
  const outlineControls = useMemo(
    () => ({ targets: visibleOutlines, onChange: setVisibleOutlines }),
    [visibleOutlines],
  );

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
        <SourcesSection defaultOpen outlineControls={outlineControls} />
        <Separator />
        <InstancesSection defaultOpen outlineControls={outlineControls} />
        <Separator />
        <AxesSection defaultOpen />
      </div>
    </aside>
  );
};
