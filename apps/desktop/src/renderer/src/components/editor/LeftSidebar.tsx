import { useCallback, useEffect, useMemo, useState } from "react";
import { Separator } from "@shift/ui";
import type { SourceId } from "@shift/types";
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
  const [inheritedSourceOutlines, setInheritedSourceOutlines] = useState<
    readonly GlyphOutlineTarget[]
  >([]);
  const [sourceOutlineGroupActive, setSourceOutlineGroupActive] = useState(false);
  const [visibleInstanceOutlines, setVisibleInstanceOutlines] = useState<
    readonly GlyphOutlineTarget[]
  >([]);
  const [inheritedInstanceOutlines, setInheritedInstanceOutlines] = useState<
    readonly GlyphOutlineTarget[]
  >([]);
  const [instanceOutlineGroupActive, setInstanceOutlineGroupActive] = useState(false);
  const [hiddenSelectedSourceIds, setHiddenSelectedSourceIds] = useState<ReadonlySet<SourceId>>(
    new Set(),
  );

  useEffect(() => {
    setHiddenSelectedSourceIds((previous) => {
      const next = new Set(
        Array.from(previous).filter(
          (sourceId) => editingSourceIds.has(sourceId) && sourceId !== activeSourceId,
        ),
      );
      return next.size === previous.size ? previous : next;
    });
  }, [activeSourceId, editingSourceIds]);

  const explicitSourceOutlines = useMemo(
    () =>
      visibleSourceOutlines.filter(
        (target) => target.kind === "source" && target.sourceId !== activeSourceId,
      ),
    [activeSourceId, visibleSourceOutlines],
  );
  const selectedSourceOutlines = useMemo(() => {
    const explicitSourceIds = new Set(
      explicitSourceOutlines.flatMap((target) =>
        target.kind === "source" ? [target.sourceId] : [],
      ),
    );

    return Array.from(editingSourceIds)
      .filter(
        (sourceId) =>
          sourceId !== activeSourceId &&
          !hiddenSelectedSourceIds.has(sourceId) &&
          !explicitSourceIds.has(sourceId),
      )
      .map((sourceId): GlyphOutlineTarget => ({ kind: "source", sourceId }));
  }, [activeSourceId, editingSourceIds, explicitSourceOutlines, hiddenSelectedSourceIds]);
  const inheritedSourceTargets = useMemo(() => {
    const occupiedSourceIds = new Set(
      [...explicitSourceOutlines, ...selectedSourceOutlines].flatMap((target) =>
        target.kind === "source" ? [target.sourceId] : [],
      ),
    );
    const groupTargets = inheritedSourceOutlines.filter(
      (target) =>
        target.kind === "source" &&
        target.sourceId !== activeSourceId &&
        !occupiedSourceIds.has(target.sourceId),
    );

    return [...selectedSourceOutlines, ...groupTargets];
  }, [activeSourceId, explicitSourceOutlines, inheritedSourceOutlines, selectedSourceOutlines]);
  const sourceOutlines = useMemo(
    () => [...explicitSourceOutlines, ...inheritedSourceTargets],
    [explicitSourceOutlines, inheritedSourceTargets],
  );

  const toggleSourceOutline = useCallback(
    (target: GlyphOutlineTarget) => {
      if (target.kind !== "source" || target.sourceId === activeSourceId) return;

      const inherited = inheritedSourceTargets.some(
        (candidate) => candidate.kind === "source" && candidate.sourceId === target.sourceId,
      );
      const selected = editingSourceIds.has(target.sourceId);
      if (inherited) {
        if (selected) {
          setHiddenSelectedSourceIds((previous) => new Set(previous).add(target.sourceId));
        }
        setInheritedSourceOutlines((previous) =>
          previous.filter(
            (candidate) => candidate.kind !== "source" || candidate.sourceId !== target.sourceId,
          ),
        );
        return;
      }

      const explicit = visibleSourceOutlines.some(
        (candidate) => candidate.kind === "source" && candidate.sourceId === target.sourceId,
      );
      if (explicit) {
        setVisibleSourceOutlines((previous) =>
          previous.filter(
            (candidate) => candidate.kind !== "source" || candidate.sourceId !== target.sourceId,
          ),
        );
        if (selected) {
          setHiddenSelectedSourceIds((previous) => new Set(previous).add(target.sourceId));
        }
        setInheritedSourceOutlines((previous) =>
          previous.filter(
            (candidate) => candidate.kind !== "source" || candidate.sourceId !== target.sourceId,
          ),
        );
        return;
      }

      setVisibleSourceOutlines((previous) => [...previous, target]);
      if (selected) {
        setHiddenSelectedSourceIds((previous) => {
          const next = new Set(previous);
          next.delete(target.sourceId);
          return next;
        });
      }
    },
    [activeSourceId, editingSourceIds, inheritedSourceTargets, visibleSourceOutlines],
  );

  const toggleSourceOutlineGroup = useCallback(
    (targets: readonly GlyphOutlineTarget[]) => {
      if (sourceOutlineGroupActive) {
        setSourceOutlineGroupActive(false);
        setInheritedSourceOutlines([]);
        return;
      }

      const visibleSourceIds = new Set(
        sourceOutlines.flatMap((target) => (target.kind === "source" ? [target.sourceId] : [])),
      );
      setInheritedSourceOutlines(
        targets.filter(
          (target) => target.kind === "source" && !visibleSourceIds.has(target.sourceId),
        ),
      );
      setSourceOutlineGroupActive(true);
    },
    [sourceOutlineGroupActive, sourceOutlines],
  );

  const inheritedInstanceTargets = useMemo(() => {
    const visibleInstanceIds = new Set(
      visibleInstanceOutlines.flatMap((target) =>
        target.kind === "instance" ? [target.instanceId] : [],
      ),
    );

    return inheritedInstanceOutlines.filter(
      (target) => target.kind === "instance" && !visibleInstanceIds.has(target.instanceId),
    );
  }, [inheritedInstanceOutlines, visibleInstanceOutlines]);
  const instanceOutlines = useMemo(
    () => [...visibleInstanceOutlines, ...inheritedInstanceTargets],
    [inheritedInstanceTargets, visibleInstanceOutlines],
  );

  const toggleInstanceOutline = useCallback(
    (target: GlyphOutlineTarget) => {
      if (target.kind !== "instance") return;

      const inherited = inheritedInstanceTargets.some(
        (candidate) => candidate.kind === "instance" && candidate.instanceId === target.instanceId,
      );
      if (inherited) {
        setInheritedInstanceOutlines((previous) =>
          previous.filter(
            (candidate) =>
              candidate.kind !== "instance" || candidate.instanceId !== target.instanceId,
          ),
        );
        return;
      }

      const visible = visibleInstanceOutlines.some(
        (candidate) => candidate.kind === "instance" && candidate.instanceId === target.instanceId,
      );
      setVisibleInstanceOutlines((previous) =>
        visible
          ? previous.filter(
              (candidate) =>
                candidate.kind !== "instance" || candidate.instanceId !== target.instanceId,
            )
          : [...previous, target],
      );
    },
    [inheritedInstanceTargets, visibleInstanceOutlines],
  );

  const toggleInstanceOutlineGroup = useCallback(
    (targets: readonly GlyphOutlineTarget[]) => {
      if (instanceOutlineGroupActive) {
        setInstanceOutlineGroupActive(false);
        setInheritedInstanceOutlines([]);
        return;
      }

      const visibleInstanceIds = new Set(
        instanceOutlines.flatMap((target) =>
          target.kind === "instance" ? [target.instanceId] : [],
        ),
      );
      setInheritedInstanceOutlines(
        targets.filter(
          (target) => target.kind === "instance" && !visibleInstanceIds.has(target.instanceId),
        ),
      );
      setInstanceOutlineGroupActive(true);
    },
    [instanceOutlineGroupActive, instanceOutlines],
  );

  const sourceOutlineControls = useMemo(
    () => ({
      targets: sourceOutlines,
      inheritedTargets: inheritedSourceTargets,
      groupActive: sourceOutlineGroupActive,
      onToggle: toggleSourceOutline,
      onToggleGroup: toggleSourceOutlineGroup,
    }),
    [
      inheritedSourceTargets,
      sourceOutlineGroupActive,
      sourceOutlines,
      toggleSourceOutline,
      toggleSourceOutlineGroup,
    ],
  );
  const instanceOutlineControls = useMemo(
    () => ({
      targets: instanceOutlines,
      inheritedTargets: inheritedInstanceTargets,
      groupActive: instanceOutlineGroupActive,
      onToggle: toggleInstanceOutline,
      onToggleGroup: toggleInstanceOutlineGroup,
    }),
    [
      inheritedInstanceTargets,
      instanceOutlineGroupActive,
      instanceOutlines,
      toggleInstanceOutline,
      toggleInstanceOutlineGroup,
    ],
  );
  const visibleOutlines = useMemo(
    () => [...sourceOutlines, ...instanceOutlines],
    [instanceOutlines, sourceOutlines],
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
        <SourcesSection defaultOpen outlineControls={sourceOutlineControls} />
        <Separator />
        <InstancesSection defaultOpen outlineControls={instanceOutlineControls} />
        <Separator />
        <AxesSection defaultOpen />
      </div>
    </aside>
  );
};
