import { useState } from "react";
import { Vec2, type Point2D } from "@shift/geo";
import { Point } from "@shift/glyph-state";
import { isPointId } from "@shift/types";
import { EditableSidebarInput } from "./EditableSidebarInput";
import { SidebarSection } from "./SidebarSection";
import { useSignalEffect } from "@/hooks/useSignalEffect";
import type { GlyphLayer } from "@shift/editor/lib/model/Glyph";
import { PointRuleConstraint } from "@shift/editor/lib/model/positions/index";
import { track } from "@shift/editor/lib/signals/index";
import type { CubicHandle } from "@shift/editor/types/handle";
import { useEditor } from "@/workspace/WorkspaceContext";
import RotateIcon from "@/assets/sidebar-right/rotate.svg";

const toDegrees = (radians: number): number => (radians * 180) / Math.PI;
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

const roundDisplayValue = (value: number): number => {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
};

export const HandleSection = () => {
  const editor = useEditor();
  const [handle, setHandle] = useState<CubicHandle | null>(null);
  const [layer, setLayer] = useState<GlyphLayer | null>(null);

  useSignalEffect(() => {
    track(editor.externalLocationCell);
    track(editor.activeSourceIdCell);
    const selection = editor.selection.stateCell.value;
    const selectedId = selection.ids.length === 1 ? selection.ids[0] : null;
    const object = selectedId && isPointId(selectedId) ? editor.object(selectedId) : null;
    const point = object?.kind === "point" ? object.geometry.point(object.pointId) : null;
    const contour = object?.kind === "point" ? object.geometry.contour(object.contourId) : null;
    const anchor = point && contour ? contour.cubicHandleAnchor(point.id) : null;

    if (!object || object.kind !== "point" || !object.layer || !point || !anchor) {
      setHandle(null);
      setLayer(null);
      return;
    }

    if (!Point.isOffCurve(point)) {
      setHandle(null);
      setLayer(null);
      return;
    }

    setHandle({
      pointId: point.id,
      anchor: { x: anchor.x, y: anchor.y },
      position: { x: point.x, y: point.y },
      angleDegrees: toDegrees(Vec2.angleTo(anchor, point)),
      length: Vec2.len(Vec2.sub(point, anchor)),
    });
    setLayer(object.layer);
  });

  if (!handle || !layer) return null;

  const moveHandle = (position: Point2D, label: string) => {
    const delta = Vec2.sub(position, handle.position);
    if (Vec2.len(delta) < 1e-9) return;

    const pointIds = [handle.pointId];
    const move = layer.positions
      .move({ points: pointIds })
      .constrainedBy(PointRuleConstraint.forSelection(layer.geometry, pointIds));
    move.preview(delta);
    move.commit(label);
  };

  const handleAngleChange = (angleDegrees: number) => {
    const angle = toRadians(angleDegrees);
    moveHandle(
      {
        x: handle.anchor.x + Math.cos(angle) * handle.length,
        y: handle.anchor.y + Math.sin(angle) * handle.length,
      },
      "Set handle angle",
    );
  };

  const handleLengthChange = (length: number) => {
    const angle = toRadians(handle.angleDegrees);
    const nextLength = Math.max(0, length);
    moveHandle(
      {
        x: handle.anchor.x + Math.cos(angle) * nextLength,
        y: handle.anchor.y + Math.sin(angle) * nextLength,
      },
      "Set handle length",
    );
  };

  return (
    <SidebarSection title="Handle">
      <div className="flex gap-2">
        <EditableSidebarInput
          ariaLabel="Handle angle"
          className="pl-8"
          value={roundDisplayValue(handle.angleDegrees)}
          suffix="°"
          iconPosition="left"
          icon={<RotateIcon className="w-5 h-5 text-sidebar-icon" />}
          onValueChange={handleAngleChange}
        />
        <EditableSidebarInput
          ariaLabel="Handle length"
          label="L"
          value={roundDisplayValue(handle.length)}
          onValueChange={handleLengthChange}
        />
      </div>
    </SidebarSection>
  );
};
