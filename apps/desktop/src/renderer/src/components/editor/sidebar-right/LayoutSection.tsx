import { useSignalState } from "@shift/editor/signals";
import type { Editor } from "@shift/editor";
import type {
  FrameAlign,
  FrameAxis,
  FrameJustify,
  FrameMode,
  FrameNode,
  ShiftNode,
  Sizing,
} from "@shift/editor/types";
import type { NodeId } from "@shift/types";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Select,
  SelectIcon,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectList,
  SelectPopup,
  SelectPortal,
  SelectPositioner,
  SelectTrigger,
  SelectValue,
  Toggle,
  ToggleGroup,
  Tooltip,
} from "@shift/ui";
import { IconButton } from "./IconButton";
import { SidebarNumberField } from "./SidebarNumberField";
import { SidebarSection, SidebarSubsection } from "./SidebarSection";
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

/** The selected frame's auto layout: direction, spacing, alignment, sizing, and child order. */
export const LayoutSection = ({ frameId }: { readonly frameId: NodeId }) => {
  const editor = useEditor();
  useSignalState(editor.scene.cell);
  const laidOut = useSignalState(editor.frames.laidOutCell(frameId));
  const frame = editor.scene.nodeOfKind(frameId, "frame");
  if (!frame) return null;

  const box = laidOut?.box ?? null;
  const children = editor.scene.children(frame.id);
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

      {children.length > 0 ? (
        <SidebarSubsection title="Children">
          <ul className="flex flex-col gap-1">
            {children.map((child, index) => (
              <li key={child.id} className="flex h-6 items-center gap-1">
                <span className="min-w-0 flex-1 truncate text-ui text-primary">
                  {childLabel(editor, child)}
                </span>
                <IconButton
                  ariaLabel="Move up"
                  icon={ArrowUp}
                  disabled={index === 0}
                  onClick={() => editor.frames.moveChild(child.id, index - 1)}
                />
                <IconButton
                  ariaLabel="Move down"
                  icon={ArrowDown}
                  disabled={index === children.length - 1}
                  onClick={() => editor.frames.moveChild(child.id, index + 1)}
                />
              </li>
            ))}
          </ul>
        </SidebarSubsection>
      ) : null}
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

function LabelledSelect<Value extends string>({
  label,
  value,
  labels,
  onChange,
  hideLabel = false,
}: {
  readonly label: string;
  readonly value: Value;
  readonly labels: Record<Value, string>;
  readonly onChange: (value: Value) => void;
  readonly hideLabel?: boolean;
}) {
  const options = Object.keys(labels) as Value[];
  return (
    <label className="flex w-full min-w-0 flex-col gap-1">
      {hideLabel ? null : <span className="text-ui text-secondary">{label}</span>}
      <Select
        value={value}
        items={labels}
        onValueChange={(next) => {
          if (next !== null) onChange(next as Value);
        }}
      >
        <SelectTrigger aria-label={label} className="h-6 w-full">
          <SelectValue />
          <SelectIcon />
        </SelectTrigger>
        <SelectPortal>
          <SelectPositioner sideOffset={4}>
            <SelectPopup>
              <SelectList>
                {options.map((option) => (
                  <SelectItem key={option} value={option}>
                    <SelectItemIndicator />
                    <SelectItemText>{labels[option]}</SelectItemText>
                  </SelectItem>
                ))}
              </SelectList>
            </SelectPopup>
          </SelectPositioner>
        </SelectPortal>
      </Select>
    </label>
  );
}

function isFrameMode(value: string): value is FrameMode {
  return value === "row" || value === "column";
}

/** The padding shown in the single linked field, or null when the sides differ. */
function sharedPadding(frame: FrameNode): number | null {
  const { top, right, bottom, left } = frame.layout.padding;
  return top === right && right === bottom && bottom === left ? top : null;
}

/** A child's row label: a frame's name, or a run's size and length. */
function childLabel(editor: Editor, child: ShiftNode): string {
  switch (child.kind) {
    case "frame":
      return child.name;
    case "textRun":
      return `Text ${child.size} · ${editor.text.items(child).length} glyphs`;
    case "glyph":
    case "page":
      return child.kind;
  }
}
