import { useRef, useState } from "react";
import { Input, Tooltip } from "@shift/ui";
import { isAnchorId, type AnchorId } from "@shift/types";
import { useSignalEffect } from "@/hooks/useSignalEffect";
import { track } from "@shift/editor/signals";
import { PositionEdits, type GlyphLayer } from "@shift/editor/model";
import { Vec2, type PointAxis } from "@shift/geo";
import { useFocusZone } from "@/context/FocusZoneContext";
import { useEditor } from "@/workspace/WorkspaceContext";
import { SidebarNumberField } from "./SidebarNumberField";
import { SidebarSection } from "./SidebarSection";

export const AnchorSection = () => {
  const editor = useEditor();
  const [anchorId, setAnchorId] = useState<AnchorId | null>(null);
  const [anchorName, setAnchorName] = useState<string | null>(null);
  const [layer, setLayer] = useState<GlyphLayer | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  useSignalEffect(() => {
    track(editor.externalLocationCell);
    track(editor.activeSourceIdCell);
    const selection = editor.selection.stateCell.value;
    const selectedId = selection.ids.length === 1 ? selection.ids[0] : null;
    const object = selectedId && isAnchorId(selectedId) ? editor.object(selectedId) : null;
    const anchor = object?.kind === "anchor" ? object.geometry.anchor(object.anchorId) : null;
    if (!object || object.kind !== "anchor" || !anchor) {
      setAnchorId(null);
      setAnchorName(null);
      setLayer(null);
      setPosition({ x: 0, y: 0 });
      return;
    }

    setAnchorId(anchor.id);
    setAnchorName(anchor.name ?? null);
    setLayer(object.layer);
    setPosition({ x: Math.round(anchor.x), y: Math.round(anchor.y) });
  });

  const handlePositionChange = (axis: PointAxis, value: number) => {
    if (!anchorId || !layer) return;

    const positionSelection = editor.positionSelection([anchorId]);
    const currentAnchor = positionSelection?.layer.anchor(anchorId);
    if (!positionSelection || !currentAnchor) return;

    const delta = Vec2.fromAxis(axis, value - currentAnchor[axis]);
    const move = PositionEdits.fromSelection(positionSelection).move(positionSelection.targets);
    move.preview(delta);
    move.commit("Move anchor");
  };

  const editable = anchorId !== null && layer !== null;

  return (
    <SidebarSection title="Anchor">
      <AnchorNameField
        key={`${anchorId}:${anchorName}`}
        name={anchorName}
        disabled={!editable}
        onCommit={(name) => anchorId && editor.renameAnchor(anchorId, name)}
      />
      <div className="flex gap-2">
        <SidebarNumberField
          ariaLabel="Anchor X position"
          label="X"
          value={position.x}
          disabled={!editable}
          onValueCommit={(value) => handlePositionChange("x", value)}
        />
        <SidebarNumberField
          ariaLabel="Anchor Y position"
          label="Y"
          value={position.y}
          disabled={!editable}
          onValueCommit={(value) => handlePositionChange("y", value)}
        />
      </div>
    </SidebarSection>
  );
};

interface AnchorNameFieldProps {
  name: string | null;
  disabled: boolean;
  onCommit: (name: string) => void;
}

/**
 * The anchor's name, renamed in every source on Enter or blur.
 *
 * @remarks
 * Escape leaves the field without renaming. While focused, the sidebar keeps
 * keyboard focus and editor shortcuts do not fire.
 */
function AnchorNameField({ name, disabled, onCommit }: AnchorNameFieldProps) {
  const { lockToZone, unlock } = useFocusZone();
  const [draft, setDraft] = useState(name ?? "");
  const cancelled = useRef(false);

  return (
    <Tooltip content="Anchor name">
      <Input
        aria-label="Anchor name"
        value={draft}
        placeholder="Unnamed anchor"
        disabled={disabled}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onFocus={(event) => {
          cancelled.current = false;
          lockToZone("sidebar");
          event.currentTarget.select();
        }}
        onBlur={() => {
          unlock();
          if (cancelled.current) setDraft(name ?? "");
          else if (draft !== (name ?? "")) onCommit(draft);
        }}
        onKeyDown={(event) => {
          event.nativeEvent.stopImmediatePropagation();
          if (event.key === "Escape") cancelled.current = true;
          if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
        }}
      />
    </Tooltip>
  );
}
