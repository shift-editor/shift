import { useCallback, useMemo, useState } from "react";
import { computed, track, useSignalState } from "@shift/editor/signals";
import type { SelectableId } from "@shift/editor/types";
import { useEditor } from "@/workspace/WorkspaceContext";
import type { ObjectTreeSectionId } from "@/types/objectTree";
import { useListSelection } from "@/hooks/useListSelection";
import { createObjectTree } from "./object-tree/createObjectTree";
import { flattenVisibleObjectRows } from "./object-tree/flattenVisibleObjectRows";
import { ObjectRow } from "./object-tree/ObjectRow";
import { ObjectSectionRow } from "./object-tree/ObjectSectionRow";

export const ObjectsPanel = () => {
  const editor = useEditor();
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
  const selection = useSignalState(editor.selection.stateCell);
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

  const { selectItem: selectObject } = useListSelection(visibleObjectIds, selection.ids, (ids) =>
    editor.selection.select(ids),
  );

  const setObjectOpen = useCallback((id: SelectableId, open: boolean) => {
    setCollapsedObjectIds((previous) => {
      const next = new Set(previous);
      if (open) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <nav aria-label="Glyph objects" className="flex flex-col gap-2 pt-2">
      {objectTree.map((section) => {
        const rows = objectRowsBySection.get(section.id) ?? [];
        const visibleIds = visibleObjectIdsBySection.get(section.id) ?? [];

        return (
          <ObjectSectionRow
            key={section.id}
            title={section.label}
            open={!collapsedSectionIds.has(section.id)}
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
              <div className="flex flex-col gap-1">
                {rows.map((row, index) => {
                  const previousId = visibleIds[index - 1];
                  const nextId = visibleIds[index + 1];
                  const isSelected = selectedIds.has(row.item.id);

                  return (
                    <ObjectRow
                      key={row.item.id}
                      row={row}
                      isCollapsed={collapsedObjectIds.has(row.item.id)}
                      isSelected={isSelected}
                      joinsPrevious={
                        isSelected && previousId !== undefined && selectedIds.has(previousId)
                      }
                      joinsNext={isSelected && nextId !== undefined && selectedIds.has(nextId)}
                      onOpenChange={setObjectOpen}
                      selectObject={selectObject}
                    />
                  );
                })}
              </div>
            ) : null}
          </ObjectSectionRow>
        );
      })}
    </nav>
  );
};
