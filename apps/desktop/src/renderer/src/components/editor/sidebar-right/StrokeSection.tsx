import { useMemo } from "react";
import { useSignalState } from "@shift/editor/signals";
import {
  Button,
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuTrigger,
  Tooltip,
} from "@shift/ui";
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
import { notify } from "@/lib/notifications/notify";
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
  if (!view) return null;

  const change = (patch: StrokeStylePatch) => report(updateStrokeStyle(editor, patch));

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
              onExpand={() => report(expandStroke(editor))}
              onRemove={() => report(removeDynamicStroke(editor))}
              onOffset={openOffsetDialog}
            />
          ) : null}
        </div>
      }
    >
      {view.hasStroke ? <StrokeFields view={view} onChange={change} /> : null}
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
  readonly onExpand: () => void;
  readonly onRemove: () => void;
  readonly onOffset: () => Promise<void>;
}

/** The commands that act on the strokes already there, beyond editing their style. */
const StrokeMenu = ({ onExpand, onRemove, onOffset }: StrokeMenuProps) => (
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
          <MenuItem onClick={onExpand}>Expand Stroke</MenuItem>
          <MenuItem onClick={onRemove}>Remove Dynamic Stroke</MenuItem>
          <MenuItem onClick={onOffset}>Offset Contour…</MenuItem>
        </MenuPopup>
      </MenuPositioner>
    </MenuPortal>
  </Menu>
);
