import { useRef, useState, useMemo } from "react";
import { useSignalState } from "@shift/editor/signals";
import {
  Button,
  Input,
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuSeparator,
  MenuTrigger,
  Tooltip,
} from "@shift/ui";
import MinusIcon from "@/assets/general/minus.svg";
import PlusIcon from "@/assets/general/plus.svg";
import VerticalEllipsis from "@/assets/general/vertical-ellipsis.svg";
import { SidebarActionButton } from "@/components/sidebar";
import { getShiftHost } from "@/host/shiftHost";
import {
  applyDynamicStroke,
  expandStroke,
  removeDynamicStroke,
  updateStrokeStyle,
} from "@/lib/commands/strokeCommands";
import {
  applyStrokePreset,
  copiedStrokeStyleCell,
  copyStrokeStyle,
  deleteStrokePreset,
  pasteStrokeStyle,
  saveAsStrokePreset,
} from "@/lib/commands/strokePresetCommands";
import { notify } from "@/lib/notifications/notify";
import type { StrokePreset } from "@shift/wasm/protocol";
import type { StrokeCommandResult, StrokeSectionView, StrokeStylePatch } from "@/types/stroke";
import { useEditor } from "@/workspace/WorkspaceContext";
import { IconButton } from "./IconButton";
import { SidebarNumberField } from "./SidebarNumberField";
import { SidebarRow } from "./SidebarRow";
import { SidebarSection } from "./SidebarSection";
import { CAPS, JOINS } from "./strokeChoices";
import {
  miterLimitPatch,
  positionPatch,
  strokeSectionViewCell,
  widthPatch,
} from "./strokeSectionModel";

/** Tells the user why a stroke command refused; a command that ran says nothing. */
function report(result: StrokeCommandResult): void {
  if (!result.ok) notify(result.reason);
}

/**
 * Asks for Offset Contour…, which opens its dialog, or says why it cannot.
 *
 * It goes through the host, as the native menu does, so every entry point shares one route.
 */
async function openOffsetDialog(): Promise<void> {
  try {
    await getShiftHost().commands.run("glyph.stroke.offsetContour");
  } catch (error) {
    console.error("offset contour command failed", error);
  }
}

/**
 * The Stroke section: adds a dynamic stroke to the selected contours and edits the strokes
 * they have, live.
 *
 * @remarks
 * A control that cannot change anything stays pressable: the command refuses and the reason
 * shows as a notification, so the user hears why instead of meeting a dead control.
 */
export const StrokeSection = () => {
  const editor = useEditor();
  const viewCell = useMemo(() => strokeSectionViewCell(editor), [editor]);
  const view = useSignalState(viewCell);
  const hasCopied = useSignalState(copiedStrokeStyleCell) !== null;
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  if (!view) return null;

  const change = (patch: StrokeStylePatch) => report(updateStrokeStyle(editor, patch));

  function commitSavePreset(): void {
    if (!view) return;

    // Build the style from the view's current fields, falling back to the editor's
    // last-used style for fields the view could not determine (mixed selection).
    const base = editor.newStrokeStyleCell.peek();
    const style = {
      width: view.width ?? base.width,
      position: view.positionPercent != null ? view.positionPercent / 100 : base.position,
      join: view.join ?? base.join,
      miterLimit: view.miterLimit ?? base.miterLimit,
      cap: view.cap ?? base.cap,
    };
    const result = saveAsStrokePreset(editor, presetName, style);
    if (!result.ok) {
      notify(result.reason);
      return;
    }
    setSavingPreset(false);
    setPresetName("");
  }

  return (
    <SidebarSection
      title="Stroke"
      actions={
        <div className="flex items-center">
          {view.canAdd ? (
            <SidebarActionButton
              label="Add dynamic stroke"
              onClick={() => report(applyDynamicStroke(editor))}
            >
              <PlusIcon className="h-3 w-3" />
            </SidebarActionButton>
          ) : null}
          {view.hasStroke ? (
            <StrokeMenu
              hasCopied={hasCopied}
              onExpand={() => report(expandStroke(editor))}
              onRemove={() => report(removeDynamicStroke(editor))}
              onOffset={openOffsetDialog}
              onSaveAsPreset={() => {
                setSavingPreset(true);
                setTimeout(() => nameInputRef.current?.focus(), 0);
              }}
              onCopy={() => report(copyStrokeStyle(editor))}
              onPaste={() => report(pasteStrokeStyle(editor))}
            />
          ) : null}
        </div>
      }
    >
      {view.hasStroke ? <StrokeFields view={view} onChange={change} /> : null}
      {savingPreset ? (
        <div className="flex gap-1 px-1 pb-1">
          <Input
            ref={nameInputRef}
            placeholder="Preset name"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitSavePreset();
              if (e.key === "Escape") {
                setSavingPreset(false);
                setPresetName("");
              }
            }}
            size="compact"
            className="flex-1"
          />
          <Button size="sm" onClick={commitSavePreset}>
            Save
          </Button>
        </div>
      ) : null}
      {view.presets.length > 0 ? (
        <StrokePresetList
          presets={view.presets}
          onApply={(id) => report(applyStrokePreset(editor, id))}
          onDelete={(id) => report(deleteStrokePreset(editor, id))}
        />
      ) : null}
    </SidebarSection>
  );
};

interface StrokeFieldsProps {
  readonly view: StrokeSectionView;
  readonly onChange: (patch: StrokeStylePatch) => void;
}

const StrokeFields = ({ view, onChange }: StrokeFieldsProps) => {
  // Fields that cannot change anything are disabled; `+` and the menu stay pressable and say why.
  const disabled = view.disabledReason !== null;

  return (
    <>
      <div className="flex gap-2">
        <SidebarNumberField
          ariaLabel="Stroke width"
          label="W"
          value={view.width}
          placeholder="Mixed"
          disabled={disabled}
          onValueCommit={(width) => onChange(widthPatch(width))}
        />
        <SidebarNumberField
          ariaLabel="Stroke position"
          label="P"
          suffix="%"
          value={view.positionPercent}
          placeholder="Mixed"
          disabled={disabled}
          onValueCommit={(percent) => onChange(positionPatch(percent))}
        />
      </div>
      <SidebarRow label="Join">
        <div className="flex gap-1" role="group" aria-label="Stroke join">
          {JOINS.map(({ join, label, Icon }) => (
            <IconButton
              key={join}
              ariaLabel={label}
              icon={Icon}
              pressed={view.join === join}
              disabled={disabled}
              onClick={() => onChange({ join })}
            />
          ))}
        </div>
      </SidebarRow>
      {view.showsMiterLimit ? (
        <SidebarRow label="Miter limit">
          <div className="w-20">
            <SidebarNumberField
              ariaLabel="Miter limit"
              value={view.miterLimit}
              placeholder="Mixed"
              disabled={disabled}
              onValueCommit={(miterLimit) => onChange(miterLimitPatch(miterLimit))}
            />
          </div>
        </SidebarRow>
      ) : null}
      {view.showsCap ? (
        <SidebarRow label="Cap">
          <div className="flex gap-1" role="group" aria-label="Stroke cap">
            {CAPS.map(({ cap, label, Icon }) => (
              <IconButton
                key={cap}
                ariaLabel={label}
                icon={Icon}
                pressed={view.cap === cap}
                disabled={disabled}
                onClick={() => onChange({ cap })}
              />
            ))}
          </div>
        </SidebarRow>
      ) : null}
    </>
  );
};

interface StrokeMenuProps {
  readonly hasCopied: boolean;
  readonly onExpand: () => void;
  readonly onRemove: () => void;
  readonly onOffset: () => Promise<void>;
  readonly onSaveAsPreset: () => void;
  readonly onCopy: () => void;
  readonly onPaste: () => void;
}

/** The commands that act on the strokes already there, beyond editing their style. */
const StrokeMenu = ({
  hasCopied,
  onExpand,
  onRemove,
  onOffset,
  onSaveAsPreset,
  onCopy,
  onPaste,
}: StrokeMenuProps) => (
  <Menu modal={false}>
    <Tooltip content="Stroke actions">
      <MenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Stroke actions"
            className="text-sidebar-icon"
          />
        }
      >
        <VerticalEllipsis className="h-5 w-5 text-icon-subtle" />
      </MenuTrigger>
    </Tooltip>
    <MenuPortal>
      <MenuPositioner sideOffset={4} align="end">
        <MenuPopup>
          <MenuItem onClick={onCopy}>Copy Stroke Style</MenuItem>
          <MenuItem onClick={onPaste} disabled={!hasCopied}>
            Paste Stroke Style
          </MenuItem>
          <MenuSeparator />
          <MenuItem onClick={onSaveAsPreset}>Save as Preset…</MenuItem>
          <MenuSeparator />
          <MenuItem onClick={onExpand}>Expand Stroke</MenuItem>
          <MenuItem onClick={onRemove}>Remove Dynamic Stroke</MenuItem>
          <MenuItem onClick={onOffset}>Offset Contour…</MenuItem>
        </MenuPopup>
      </MenuPositioner>
    </MenuPortal>
  </Menu>
);

interface StrokePresetListProps {
  readonly presets: readonly StrokePreset[];
  readonly onApply: (id: string) => void;
  readonly onDelete: (id: string) => void;
}

/** Minimal list of named stroke presets. Click to apply; trash icon to delete. */
const StrokePresetList = ({ presets, onApply, onDelete }: StrokePresetListProps) => (
  <div className="flex flex-col gap-0.5 px-1 pb-1">
    {presets.map((preset) => (
      <div key={preset.id} className="group flex items-center gap-1">
        <button
          type="button"
          className="flex-1 truncate rounded px-1 py-0.5 text-left text-xs hover:bg-hover"
          onClick={() => onApply(preset.id)}
        >
          {preset.name}
        </button>
        <button
          type="button"
          aria-label={`Delete preset ${preset.name}`}
          className="shrink-0 rounded p-0.5 opacity-0 hover:bg-hover group-hover:opacity-100"
          onClick={() => onDelete(preset.id)}
        >
          <MinusIcon className="h-3 w-3 text-icon-subtle" />
        </button>
      </div>
    ))}
  </div>
);
