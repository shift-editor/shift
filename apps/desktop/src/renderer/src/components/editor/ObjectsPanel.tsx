import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { computed, track, useSignalState } from "@shift/editor/signals";
import type { NodeId, SelectableId } from "@shift/types";
import type { GlyphNode } from "@shift/editor/types";
import { useEditor } from "@/workspace/WorkspaceContext";
import type { ObjectTree, ObjectTreeSectionId } from "@/types/objectTree";
import { useListSelection } from "@/hooks/useListSelection";
import {
  createGlyphIconPath,
  createObjectTree,
  ObjectTreeCache,
} from "./object-tree/createObjectTree";
import { flattenVisibleObjectRows } from "./object-tree/flattenVisibleObjectRows";
import { OBJECT_ROW_STEP, VirtualObjectRows } from "./object-tree/VirtualObjectRows";
import { ObjectSectionRow } from "./object-tree/ObjectSectionRow";
import { GlyphObjectRow } from "./object-tree/GlyphObjectRow";

/** One glyph's object tree in the panel. */
interface GlyphObjects {
  readonly node: GlyphNode;
  readonly name: string;
  readonly iconPath: string | undefined;
  readonly tree: ObjectTree;
}

/** A section of one glyph's tree, such as that glyph's contours. */
type SectionKey = `${NodeId}:${ObjectTreeSectionId}`;

const sectionKey = (nodeId: NodeId, sectionId: ObjectTreeSectionId): SectionKey =>
  `${nodeId}:${sectionId}`;

const HEADER_HEIGHT = 28;
const GAP = 8;

export const ObjectsPanel = () => {
  const editor = useEditor();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [focusedObjectId, setFocusedObjectId] = useState<SelectableId | null>(null);
  const [focusedParentId, setFocusedParentId] = useState<SelectableId | null>(null);
  const [pendingFocusId, setPendingFocusId] = useState<SelectableId | null>(null);
  const lastFocusedIndexRef = useRef(0);
  const glyphsCell = useMemo(() => {
    // non-reactive: per-glyph caches that reuse unchanged contours' items, so an edit rebuilds only what it touched
    const caches = new Map<NodeId, ObjectTreeCache>();
    return computed((): readonly GlyphObjects[] => {
      const glyphNodes = editor.scene.cell.value.nodes.filter(
        (node): node is GlyphNode => node.kind === "glyph",
      );
      const editedIds = editor.editing.stateCell.value.nodeIds;
      const edited = glyphNodes.filter((node) => editedIds.includes(node.id));
      const externalLocation = editor.externalLocationCell.value;
      const activeSourceId = editor.activeSourceIdCell.value;

      return (edited.length > 0 ? edited : glyphNodes).flatMap((node) => {
        const glyph = editor.glyphOf(node);
        if (!glyph) return [];
        const layer = activeSourceId
          ? glyph.layerForSource(activeSourceId)
          : glyph.layerAt(externalLocation);
        if (layer) track(layer.geometryCell);

        let cache = caches.get(node.id);
        if (!cache) caches.set(node.id, (cache = new ObjectTreeCache()));
        const geometry = layer?.geometry ?? glyph.geometryAt(externalLocation);
        // The preview draws the glyph as shown, components included, so it tracks their shapes too.
        const view = glyph.renderModelAt(editor.externalLocationCell, editor.activeSourceIdCell);
        const placed = view.contoursCell.value;
        for (const contour of placed) contour.trackShape();
        const metrics = editor.font.defaultSourceMetricsCell.value;
        const iconPath = createGlyphIconPath(placed, {
          ascender: metrics.ascender,
          descender: metrics.descender,
          advance: view.xAdvanceCell.value,
        });
        return [
          {
            node,
            name: glyph.name,
            iconPath,
            tree: createObjectTree(geometry, cache),
          },
        ];
      });
    });
  }, [editor]);
  const glyphs = useSignalState(glyphsCell, { schedule: "frame" });
  const selection = useSignalState(editor.selection.stateCell, { schedule: "frame" });
  const selectedIds = useMemo(() => new Set(selection.ids), [selection.ids]);
  const [glyphsOpen, setGlyphsOpen] = useState(true);
  const [collapsedGlyphIds, setCollapsedGlyphIds] = useState<ReadonlySet<NodeId>>(() => new Set());
  const [collapsedSectionKeys, setCollapsedSectionKeys] = useState<ReadonlySet<SectionKey>>(
    () => new Set(),
  );
  const [collapsedObjectIds, setCollapsedObjectIds] = useState<ReadonlySet<SelectableId>>(
    () => new Set(),
  );
  const objectRowsBySection = useMemo(() => {
    const result = new Map<SectionKey, ReturnType<typeof flattenVisibleObjectRows>>();
    for (const { node, tree } of glyphs) {
      for (const section of tree) {
        result.set(
          sectionKey(node.id, section.id),
          flattenVisibleObjectRows(section.items, collapsedObjectIds),
        );
      }
    }
    return result;
  }, [collapsedObjectIds, glyphs]);
  const visibleObjectIdsBySection = useMemo(() => {
    const result = new Map<SectionKey, readonly SelectableId[]>();
    for (const { node, tree } of glyphs) {
      for (const section of tree) {
        const key = sectionKey(node.id, section.id);
        const hidden =
          !glyphsOpen || collapsedGlyphIds.has(node.id) || collapsedSectionKeys.has(key);
        const rows = objectRowsBySection.get(key) ?? [];
        result.set(key, hidden ? [] : rows.map((row) => row.item.id));
      }
    }
    return result;
  }, [glyphsOpen, collapsedGlyphIds, collapsedSectionKeys, objectRowsBySection, glyphs]);
  const visibleObjectIds = useMemo(
    () => [...visibleObjectIdsBySection.values()].flat(),
    [visibleObjectIdsBySection],
  );
  // Walk only the selected parents: a map of every child would be rebuilt over all
  // 50K points on each edit of a large glyph.
  const coveredIds = useMemo(() => {
    const result = new Set(selectedIds);
    for (const { tree } of glyphs) {
      for (const section of tree) {
        for (const parent of section.items) {
          if (!selectedIds.has(parent.id)) continue;
          for (const child of parent.children) result.add(child.id);
        }
      }
    }
    return result;
  }, [glyphs, selectedIds]);

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

  // Glyph rows, section headers, and row spacing have fixed heights; keep the
  // scroll geometry independent of how many rows React actually mounts.
  const sectionTopByKey = new Map<SectionKey, number>();
  // Below the Glyphs heading and its panel's top padding.
  let glyphTop = GAP + HEADER_HEIGHT + GAP;
  for (const { node, tree } of glyphsOpen ? glyphs : []) {
    let blockEnd = glyphTop + HEADER_HEIGHT;
    if (!collapsedGlyphIds.has(node.id)) {
      let sectionTop = glyphTop + HEADER_HEIGHT + GAP;
      for (const section of tree) {
        const key = sectionKey(node.id, section.id);
        const rows = objectRowsBySection.get(key) ?? [];
        const open = !collapsedSectionKeys.has(key);
        sectionTopByKey.set(key, sectionTop + HEADER_HEIGHT + GAP);
        const rowsHeight =
          open && section.items.length > 0 ? GAP + rows.length * OBJECT_ROW_STEP - 4 : 0;
        blockEnd = sectionTop + HEADER_HEIGHT + rowsHeight;
        sectionTop = blockEnd + GAP;
      }
    }
    glyphTop = blockEnd + GAP;
  }

  const onFocusObject = (id: SelectableId) => {
    lastFocusedIndexRef.current = visibleObjectIds.indexOf(id);
    setFocusedObjectId(id);
    setFocusedParentId(parentOf(glyphs, id));
    setPendingFocusId(null);
  };

  const onNavigate = (id: SelectableId) => {
    const key = [...visibleObjectIdsBySection].find(([, ids]) => ids.includes(id))?.[0];
    const container = containerRef.current;
    if (!key || !container) return;

    const index = (visibleObjectIdsBySection.get(key) ?? []).indexOf(id);
    const top = sectionTopByKey.get(key);
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
        <ObjectSectionRow title="Glyphs" open={glyphsOpen} onOpenChange={setGlyphsOpen}>
          <div className="flex flex-col gap-2">
            {glyphs.map(({ node, name, iconPath, tree }) => (
              <GlyphObjectRow
                key={node.id}
                name={name}
                iconPath={iconPath}
                open={!collapsedGlyphIds.has(node.id)}
                onOpenChange={(open) =>
                  setCollapsedGlyphIds((previous) => toggled(previous, node.id, open))
                }
                onSelect={() => editor.selectGlyphContents([node])}
                onClose={() => editor.closeGlyphNode(node.id)}
              >
                {tree.map((section) => {
                  const key = sectionKey(node.id, section.id);
                  const rows = objectRowsBySection.get(key) ?? [];
                  const visibleIds = visibleObjectIdsBySection.get(key) ?? [];

                  return (
                    <ObjectSectionRow
                      key={key}
                      title={section.label}
                      open={!collapsedSectionKeys.has(key)}
                      onOpenChange={(open) =>
                        setCollapsedSectionKeys((previous) => toggled(previous, key, open))
                      }
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
                          sectionTop={sectionTopByKey.get(key) ?? 0}
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
              </GlyphObjectRow>
            ))}
          </div>
        </ObjectSectionRow>
      </nav>
    </div>
  );
};

function parentOf(glyphs: readonly GlyphObjects[], id: SelectableId): SelectableId | null {
  for (const { tree } of glyphs) {
    for (const section of tree) {
      for (const parent of section.items) {
        if (parent.children.some((child) => child.id === id)) return parent.id;
      }
    }
  }
  return null;
}

/** Returns a copy of a collapsed set with `key` collapsed or expanded. */
function toggled<K>(collapsed: ReadonlySet<K>, key: K, open: boolean): ReadonlySet<K> {
  const next = new Set(collapsed);
  if (open) next.delete(key);
  else next.add(key);
  return next;
}
