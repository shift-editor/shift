import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { computed, track, useSignalState } from "@shift/editor/signals";
import type { SelectableId } from "@shift/types";
import { useEditor } from "@/workspace/WorkspaceContext";
import type { ObjectTreeSectionId } from "@/types/objectTree";
import { useListSelection } from "@/hooks/useListSelection";
import { createObjectTree } from "./object-tree/createObjectTree";
import { flattenVisibleObjectRows } from "./object-tree/flattenVisibleObjectRows";
import { OBJECT_ROW_STEP, VirtualObjectRows } from "./object-tree/VirtualObjectRows";
import { ObjectSectionRow } from "./object-tree/ObjectSectionRow";

export const ObjectsPanel = () => {
  const editor = useEditor();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [focusedObjectId, setFocusedObjectId] = useState<SelectableId | null>(null);
  const [focusedParentId, setFocusedParentId] = useState<SelectableId | null>(null);
  const [pendingFocusId, setPendingFocusId] = useState<SelectableId | null>(null);
  const lastFocusedIndexRef = useRef(0);
  const objectTreeCell = useMemo(
    () =>
      computed(() => {
        const node = editor.scene.cell.value.nodes.find((candidate) => candidate.kind === "glyph");
        const externalLocation = editor.externalLocationCell.value;
        const activeSourceId = editor.activeSourceIdCell.value;
        if (!node) return [];

        const glyph = editor.glyphForId(node.glyphId);
        if (!glyph) return [];

        const layer = activeSourceId
          ? glyph.layerForSource(activeSourceId)
          : glyph.layerAt(externalLocation);
        if (layer) track(layer.geometryCell);

        return createObjectTree(layer?.geometry ?? glyph.geometryAt(externalLocation));
      }),
    [editor],
  );
  const objectTree = useSignalState(objectTreeCell, { schedule: "frame" });
  const selection = useSignalState(editor.selection.stateCell, { schedule: "frame" });
  const selectedIds = useMemo(() => new Set(selection.ids), [selection.ids]);
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<ReadonlySet<ObjectTreeSectionId>>(
    () => new Set(),
  );
  const [collapsedObjectIds, setCollapsedObjectIds] = useState<ReadonlySet<SelectableId>>(
    () => new Set(),
  );
  const objectRowsBySection = useMemo(() => {
    const result = new Map(
      objectTree.map((section) => [
        section.id,
        flattenVisibleObjectRows(section.items, collapsedObjectIds),
      ]),
    );

    return result;
  }, [collapsedObjectIds, objectTree]);
  const visibleObjectIdsBySection = useMemo(() => {
    const result = new Map<ObjectTreeSectionId, readonly SelectableId[]>();

    for (const section of objectTree) {
      const rows = objectRowsBySection.get(section.id) ?? [];
      result.set(
        section.id,
        collapsedSectionIds.has(section.id) ? [] : rows.map((row) => row.item.id),
      );
    }

    return result;
  }, [collapsedSectionIds, objectRowsBySection, objectTree]);
  const visibleObjectIds = useMemo(
    () => objectTree.flatMap((section) => visibleObjectIdsBySection.get(section.id) ?? []),
    [objectTree, visibleObjectIdsBySection],
  );
  const parentByObjectId = useMemo(() => {
    const result = new Map<SelectableId, SelectableId>();
    for (const section of objectTree) {
      for (const parent of section.items) {
        for (const child of parent.children) result.set(child.id, parent.id);
      }
    }
    return result;
  }, [objectTree]);

  const coveredIds = useMemo(() => {
    const result = new Set(selectedIds);
    for (const [childId, parentId] of parentByObjectId) {
      if (selectedIds.has(parentId)) result.add(childId);
    }
    return result;
  }, [parentByObjectId, selectedIds]);

  const { selectItem: selectObject } = useListSelection(visibleObjectIds, selection.ids, (ids) => {
    editor.history.capture("Select object", () => editor.selection.select(ids));
  });

  const setObjectOpen = useCallback((id: SelectableId, open: boolean) => {
    setCollapsedObjectIds((previous) => {
      const next = new Set(previous);
      if (open) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      setViewportHeight(container.clientHeight);
      setScrollTop(container.scrollTop);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    measure();

    return () => observer.disconnect();
  }, []);

  // The section headers and row spacing have fixed heights; keep the scroll
  // geometry independent of how many rows React actually mounts.
  const sectionTopById = new Map<ObjectTreeSectionId, number>();
  let sectionTop = 8;
  for (const section of objectTree) {
    const rows = objectRowsBySection.get(section.id) ?? [];
    const open = !collapsedSectionIds.has(section.id);
    sectionTopById.set(section.id, sectionTop + 28 + 8);
    sectionTop +=
      28 + (open && section.items.length > 0 ? 8 + rows.length * OBJECT_ROW_STEP - 4 : 0) + 8;
  }

  const onFocusObject = (id: SelectableId) => {
    lastFocusedIndexRef.current = visibleObjectIds.indexOf(id);
    setFocusedObjectId(id);
    setFocusedParentId(parentByObjectId.get(id) ?? null);
    setPendingFocusId(null);
  };

  const onNavigate = (id: SelectableId) => {
    const section = objectTree.find((candidate) =>
      visibleObjectIdsBySection.get(candidate.id)?.includes(id),
    );
    const container = containerRef.current;
    if (!section || !container) return;

    const index = (visibleObjectIdsBySection.get(section.id) ?? []).indexOf(id);
    const top = sectionTopById.get(section.id);
    if (index < 0 || top === undefined) return;

    setPendingFocusId(id);
    container.scrollTop = Math.max(0, top + index * OBJECT_ROW_STEP - container.clientHeight / 2);
    setScrollTop(container.scrollTop);
  };

  useLayoutEffect(() => {
    if (!focusedObjectId || visibleObjectIds.includes(focusedObjectId)) return;

    const nearest =
      focusedParentId && visibleObjectIds.includes(focusedParentId)
        ? focusedParentId
        : visibleObjectIds[Math.min(lastFocusedIndexRef.current, visibleObjectIds.length - 1)];
    if (nearest) onNavigate(nearest);
    else {
      setFocusedObjectId(null);
      setFocusedParentId(null);
    }
  }, [focusedObjectId, focusedParentId, visibleObjectIds]);

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto px-1 pb-2"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <nav aria-label="Glyph objects" className="flex flex-col gap-2 pt-2">
        {objectTree.map((section) => {
          const rows = objectRowsBySection.get(section.id) ?? [];
          const visibleIds = visibleObjectIdsBySection.get(section.id) ?? [];
          const open = !collapsedSectionIds.has(section.id);
          const rowTop = sectionTopById.get(section.id) ?? 0;

          return (
            <ObjectSectionRow
              key={section.id}
              title={section.label}
              open={open}
              onOpenChange={(open) => {
                setCollapsedSectionIds((previous) => {
                  const next = new Set(previous);
                  if (open) next.delete(section.id);
                  else next.add(section.id);
                  return next;
                });
              }}
            >
              {section.items.length > 0 ? (
                <VirtualObjectRows
                  rows={rows}
                  visibleIds={visibleIds}
                  selectedIds={selectedIds}
                  coveredIds={coveredIds}
                  collapsedObjectIds={collapsedObjectIds}
                  setObjectOpen={setObjectOpen}
                  selectObject={selectObject}
                  sectionLabel={section.label}
                  sectionTop={rowTop}
                  scrollTop={scrollTop}
                  viewportHeight={viewportHeight}
                  focusedObjectId={focusedObjectId}
                  pendingFocusId={pendingFocusId}
                  onFocusObject={onFocusObject}
                  onNavigate={onNavigate}
                  onPendingFocusResolved={() => setPendingFocusId(null)}
                  onDeleteSelection={() => editor.deleteSelection()}
                />
              ) : null}
            </ObjectSectionRow>
          );
        })}
      </nav>
    </div>
  );
};
