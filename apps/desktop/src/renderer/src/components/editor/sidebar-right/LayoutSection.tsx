import { useMemo } from "react";
import { computed, useSignalState, type Signal } from "@shift/editor/signals";
import type { Editor } from "@shift/editor";
import type {
  FrameAlign,
  FrameAxis,
  FrameJustify,
  FrameMode,
  FrameNode,
  LayoutBox,
  Sizing,
} from "@shift/editor/types";
import type { NodeId } from "@shift/types";
import { ArrowDown, ArrowRight, Toggle, ToggleGroup, Tooltip } from "@shift/ui";
import { LabelledSelect } from "./LabelledSelect";
import { SidebarNumberField } from "./SidebarNumberField";
import { SidebarSection } from "./SidebarSection";
import { useEditor } from "@/workspace/WorkspaceContext";

const ALIGN_LABELS: Record<FrameAlign, string> = {
  start: "Start",
  center: "Center",
  end: "End",
};

const JUSTIFY_LABELS: Record<FrameJustify, string> = {
  start: "Start",
  center: "Center",
  end: "End",
  "space-between": "Space between",
};

const SIZING_LABELS: Record<Sizing["kind"], string> = {
  fixed: "Fixed",
  hug: "Hug",
  fill: "Fill",
};

/** The selected frame's auto layout: direction, spacing, alignment, and sizing; order is the Layers panel's. */
export const LayoutSection = ({ frameId }: { readonly frameId: NodeId }) => {
  const editor = useEditor();
  // Dragging a frame writes its position on every pointer move; none of these follow that.
  const settingsCell = useMemo(() => frameSettingsCell(editor, frameId), [editor, frameId]);
  const sizeCell = useMemo(() => laidOutSizeCell(editor, frameId), [editor, frameId]);
  const frame = useSignalState(settingsCell);
  const box = useSignalState(sizeCell);
  if (!frame) return null;

  const setLayout = (patch: Partial<FrameNode["layout"]>) =>
    editor.frames.setLayout(frame.id, patch);

  return (
    <SidebarSection title="Layout">
      <div className="flex items-center justify-between gap-2">
        <span className="text-ui text-secondary">Direction</span>
        <ToggleGroup
          aria-label="Direction"
          value={[frame.layout.mode]}
          onValueChange={(value) => {
            const mode = value.find(isFrameMode);
            if (mode) setLayout({ mode });
          }}
        >
          <DirectionToggle mode="row" label="Row" icon={ArrowRight} />
          <DirectionToggle mode="column" label="Column" icon={ArrowDown} />
        </ToggleGroup>
      </div>

      <div className="flex gap-2">
        <SidebarNumberField
          ariaLabel="Gap"
          label="Gap"
          value={frame.layout.gap}
          onValueCommit={(gap) => setLayout({ gap: Math.max(0, gap) })}
        />
        <SidebarNumberField
          ariaLabel="Padding"
          label="Pad"
          value={sharedPadding(frame)}
          placeholder="Mixed"
          onValueCommit={(value) => {
            const side = Math.max(0, value);
            setLayout({ padding: { top: side, right: side, bottom: side, left: side } });
          }}
        />
      </div>

      <div className="flex gap-2">
        <LabelledSelect
          label="Align"
          value={frame.layout.align}
          labels={ALIGN_LABELS}
          onChange={(align) => setLayout({ align })}
        />
        <LabelledSelect
          label="Justify"
          value={frame.layout.justify}
          labels={JUSTIFY_LABELS}
          onChange={(justify) => setLayout({ justify })}
        />
      </div>

      <SizingRow frame={frame} axis="width" label="W" laidOut={box?.width ?? 0} />
      <SizingRow frame={frame} axis="height" label="H" laidOut={box?.height ?? 0} />
    </SidebarSection>
  );
};

const DirectionToggle = ({
  mode,
  label,
  icon: Icon,
}: {
  readonly mode: FrameMode;
  readonly label: string;
  readonly icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}) => (
  <Tooltip content={label}>
    <Toggle value={mode} aria-label={label}>
      <Icon className="size-3.5" aria-hidden />
    </Toggle>
  </Tooltip>
);

/** One size rule (Fixed, Hug, Fill) and, when fixed, its value. */
const SizingRow = ({
  frame,
  axis,
  label,
  laidOut,
}: {
  readonly frame: FrameNode;
  readonly axis: FrameAxis;
  readonly label: string;
  readonly laidOut: number;
}) => {
  const editor = useEditor();
  const sizing = frame[axis];
  const name = axis === "width" ? "Width" : "Height";

  const setKind = (kind: Sizing["kind"]) => {
    switch (kind) {
      case "fixed":
        editor.frames.setSizing(frame.id, axis, { kind, size: Math.round(laidOut) });
        return;
      case "hug":
      case "fill":
        editor.frames.setSizing(frame.id, axis, { kind });
        return;
    }
  };

  return (
    <div className="flex gap-2">
      <SidebarNumberField
        ariaLabel={name}
        label={label}
        value={Math.round(sizing.kind === "fixed" ? sizing.size : laidOut)}
        onValueCommit={(value) =>
          editor.frames.setSizing(frame.id, axis, { kind: "fixed", size: Math.max(0, value) })
        }
      />
      <LabelledSelect
        label={`${name} sizing`}
        value={sizing.kind}
        labels={SIZING_LABELS}
        onChange={setKind}
        hideLabel
      />
    </div>
  );
};

function isFrameMode(value: string): value is FrameMode {
  return value === "row" || value === "column";
}

/** The padding shown in the single linked field, or null when the sides differ. */
function sharedPadding(frame: FrameNode): number | null {
  const { top, right, bottom, left } = frame.layout.padding;
  return top === right && right === bottom && bottom === left ? top : null;
}

/** The frame's record; quiet while only its position changes. */
function frameSettingsCell(editor: Editor, frameId: NodeId): Signal<FrameNode | null> {
  return computed(
    () => {
      const node = editor.scene.record(frameId);
      return node?.kind === "frame" ? node : null;
    },
    { name: "LayoutSection.frame", equals: sameFrameSettings },
  );
}

/** The frame's laid-out box; quiet while only its position changes. */
function laidOutSizeCell(editor: Editor, frameId: NodeId): Signal<LayoutBox | null> {
  return computed(() => editor.frames.laidOutCell(frameId).value?.box ?? null, {
    name: "LayoutSection.size",
    equals: (a, b) => a === b || (a?.width === b?.width && a?.height === b?.height),
  });
}

/** Whether two frame records differ only in what the section does not show. */
function sameFrameSettings(a: FrameNode | null, b: FrameNode | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;

  return a.id === b.id && a.layout === b.layout && a.width === b.width && a.height === b.height;
}
