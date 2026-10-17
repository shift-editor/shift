import { useRef, useState } from "react";
import { Input, Tooltip } from "@shift/ui";
import { isAnchorId, type AnchorId } from "@shift/types";
import { useSignalEffect } from "@/hooks/useSignalEffect";
import { track } from "@shift/editor/signals";
import type { PointAxis } from "@shift/geo";
import { useFocusZone } from "@/context/FocusZoneContext";
import { useEditor } from "@/workspace/WorkspaceContext";
import { SidebarNumberField } from "./SidebarNumberField";
import { SidebarSection } from "./SidebarSection";

interface SelectedAnchors {
  readonly ids: readonly AnchorId[];
  /** The one anchor's name; `undefined` with several anchors selected. */
  readonly name: string | null | undefined;
  /** The shared coordinate on each axis, or null when the anchors differ. */
  readonly x: number | null;
  readonly y: number | null;
}

const NONE: SelectedAnchors = { ids: [], name: null, x: null, y: null };

export const AnchorSection = () => {
  const editor = useEditor();
  const [selected, setSelected] = useState<SelectedAnchors>(NONE);

  useSignalEffect(() => {
    track(editor.externalLocationCell);
    track(editor.activeSourceIdCell);
    const anchors = editor.selection.stateCell.value.ids.filter(isAnchorId).flatMap((id) => {
      const object = editor.object(id);
      const anchor = object?.kind === "anchor" ? object.geometry.anchor(id) : null;
      return anchor && object?.kind === "anchor" && object.layer ? [anchor] : [];
    });
    if (anchors.length === 0) {
      setSelected(NONE);
      return;
    }

    const shared = (axis: PointAxis) => {
      const value = Math.round(anchors[0]![axis]);
      return anchors.every((anchor) => Math.round(anchor[axis]) === value) ? value : null;
    };
    setSelected({
      ids: anchors.map((anchor) => anchor.id),
      name: anchors.length === 1 ? (anchors[0]!.name ?? null) : undefined,
      x: shared("x"),
      y: shared("y"),
    });
  });

  const single = selected.ids.length === 1;
  const editable = selected.ids.length > 0;

  return (
    <SidebarSection title={single ? "Anchor" : "Anchors"}>
      <AnchorNameField
        key={`${selected.ids.join(",")}:${selected.name}`}
        name={selected.name ?? null}
        mixed={selected.name === undefined}
        disabled={!single}
        onCommit={(name) => {
          const [anchorId] = selected.ids;
          if (anchorId) editor.renameAnchor(anchorId, name);
        }}
      />
      <div className="flex gap-2">
        {(["x", "y"] as const).map((axis) => (
          <SidebarNumberField
            key={axis}
            ariaLabel={`Anchor ${axis.toUpperCase()} position`}
            label={axis.toUpperCase()}
            value={selected[axis]}
            placeholder="Mixed"
            disabled={!editable}
            // Several anchors all move to the value typed.
            onValueCommit={(value) => editor.setAnchorAxis(selected.ids, axis, value)}
          />
        ))}
      </div>
    </SidebarSection>
  );
};

interface AnchorNameFieldProps {
  name: string | null;
  /** Several anchors are selected: their names show as Mixed and are not renamed. */
  mixed: boolean;
  disabled: boolean;
  onCommit: (name: string) => void;
}

/**
 * The anchor's name, renamed in the sources being edited on Enter or blur.
 *
 * @remarks
 * Escape leaves the field without renaming. While focused, the sidebar keeps
 * keyboard focus and editor shortcuts do not fire.
 */
function AnchorNameField({ name, mixed, disabled, onCommit }: AnchorNameFieldProps) {
  const { lockToZone, unlock } = useFocusZone();
  const [draft, setDraft] = useState(name ?? "");
  const cancelled = useRef(false);

  return (
    <Tooltip content="Anchor name">
      <Input
        aria-label="Anchor name"
        value={mixed ? "" : draft}
        placeholder={mixed ? "Mixed" : "Unnamed anchor"}
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
