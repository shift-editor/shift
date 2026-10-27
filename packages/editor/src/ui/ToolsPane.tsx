import {
  Button,
  Check,
  ChevronDown,
  Menu,
  MenuCheckboxItem,
  MenuCheckboxItemIndicator,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuTrigger,
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from "@shift/ui";
import type { ComponentType, SVGProps } from "react";
import type { Editor } from "../lib/editor/Editor";
import type { ToolName } from "../lib/tools/core/createContext";
import type { ToolMenuItem } from "../lib/tools/core/ToolManifest";
import { useSignalState } from "../lib/signals";
import { ShiftIcon, type ShiftIconName } from "./ShiftIcon";

type SVGIcon = ComponentType<SVGProps<SVGSVGElement>>;

/** Side of the tools that tooltips and tool menus open toward. */
export type ToolsPaneSide = "top" | "bottom" | "left" | "right";

export interface ToolsPaneProps {
  editor: Editor;
  /** Lays the tools out in a row or a column. Defaults to a row. */
  orientation?: "horizontal" | "vertical";
  /** Where tooltips and tool menus open, normally toward the canvas. Defaults to below. */
  popupSide?: ToolsPaneSide;
}

interface ToolButtonProps {
  Icon: SVGIcon;
  iconName?: ShiftIconName;
  name: ToolName;
  tooltip: string;
  activeTool: ToolName | null;
  disabled?: boolean;
  onClick?: () => void;
  popupSide: ToolsPaneSide;
}

interface ToolSplitButtonProps extends ToolButtonProps {
  vertical: boolean;
  menuItems: readonly ToolMenuItem[];
  onMenuItemSelect: (item: ToolMenuItem) => void;
}

function ToolButton({
  Icon,
  iconName,
  name,
  tooltip,
  activeTool,
  disabled,
  onClick,
  popupSide,
}: ToolButtonProps) {
  const isActive = activeTool === name;
  const iconClassName = cn("h-6 w-6", isActive ? "text-background" : "text-primary");

  return (
    <Tooltip>
      <TooltipTrigger>
        <ToolbarButton
          render={
            <Button
              className={cn("transition-none focus-visible:ring-0", "h-9 w-9 rounded-md")}
              variant={isActive ? "primary" : "ghost"}
              icon={
                iconName ? (
                  <ShiftIcon name={iconName} strokeWidth={1.25} className={iconClassName} />
                ) : (
                  <Icon className={iconClassName} strokeWidth={1.25} />
                )
              }
              aria-label={tooltip}
              aria-pressed={isActive}
              aria-disabled={disabled || undefined}
              isActive={isActive}
              onClick={() => {
                if (!disabled && onClick) onClick();
              }}
              size="icon"
            />
          }
        />
      </TooltipTrigger>
      <TooltipContent side={popupSide} sideOffset={5}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function ToolSplitButton({
  vertical,
  menuItems,
  onMenuItemSelect,
  ...buttonProps
}: ToolSplitButtonProps) {
  return (
    <ToolbarGroup className={cn("flex items-center gap-0.5", vertical && "flex-col")}>
      <ToolButton {...buttonProps} />
      <Menu modal={false}>
        <MenuTrigger
          disabled={buttonProps.disabled}
          render={
            <ToolbarButton
              disabled={buttonProps.disabled}
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "rounded-sm focus-visible:ring-0 data-[popup-open]:bg-hover/50",
                    vertical ? "h-5 w-9" : "h-9 w-5",
                  )}
                  icon={<ChevronDown className="h-3.5 w-3.5 text-primary" strokeWidth={1.5} />}
                  aria-label={`${buttonProps.tooltip} options`}
                  disabled={buttonProps.disabled}
                />
              }
            />
          }
        />
        <MenuPortal>
          <MenuPositioner side={buttonProps.popupSide} align="start" sideOffset={4}>
            <MenuPopup className="min-w-44">
              {menuItems.map((item) => {
                const Icon = item.icon;
                return (
                  <MenuCheckboxItem
                    key={item.id}
                    className="grid grid-cols-[1rem_1.25rem_minmax(0,1fr)_auto] gap-2"
                    checked={item.selected}
                    closeOnClick
                    onCheckedChange={() => onMenuItemSelect(item)}
                  >
                    <MenuCheckboxItemIndicator keepMounted className="data-[unchecked]:invisible">
                      <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </MenuCheckboxItemIndicator>
                    {item.id === "rectangle" || item.id === "ellipse" ? (
                      <ShiftIcon
                        name={item.id === "ellipse" ? "circle" : "shape"}
                        strokeWidth={1.25}
                        className="h-5 w-5 text-primary"
                      />
                    ) : (
                      <Icon className="h-5 w-5 text-primary" strokeWidth={1.25} />
                    )}
                    <span>{item.label}</span>
                    <kbd className="font-sans text-sm text-muted">
                      {item.shortcut.toUpperCase()}
                    </kbd>
                  </MenuCheckboxItem>
                );
              })}
            </MenuPopup>
          </MenuPositioner>
        </MenuPortal>
      </Menu>
    </ToolbarGroup>
  );
}

/** Shift's own icon for a tool slot, following the shape picked in its menu. */
function slotIconName(
  name: ToolName,
  selectedItemId: string | undefined,
): ShiftIconName | undefined {
  if (name === "shape") return selectedItemId === "ellipse" ? "circle" : "shape";
  if (name === "select" || name === "pen" || name === "hand") return name;
  return undefined;
}

export function ToolsPane({
  editor,
  orientation = "horizontal",
  popupSide = "bottom",
}: ToolsPaneProps) {
  const vertical = orientation === "vertical";
  const activeTool = useSignalState(editor.toolIdCell);
  const toolRegistry = useSignalState(editor.toolRegistryCell);

  return (
    <section className="flex flex-col items-center justify-center gap-2">
      <Toolbar
        aria-label="Editor tools"
        orientation={orientation}
        className={cn(
          "flex items-center gap-2 overflow-hidden",
          vertical ? "flex-col" : "flex-row",
        )}
      >
        {Array.from(toolRegistry.entries())
          .filter(([, item]) => !item.hidden)
          .map(([name, { icon, tooltip, menuItems, disabled }]) => {
            const selectedItem = menuItems?.find((item) => item.selected);
            const iconName = slotIconName(name, selectedItem?.id);
            // A slot holding several tools activates the one picked last.
            const slotToolId = selectedItem?.toolId ?? name;
            const slotActive =
              activeTool === name ||
              (menuItems?.some((item) => item.toolId === activeTool) ?? false);
            const buttonProps = {
              Icon: icon,
              iconName,
              name,
              tooltip,
              activeTool: slotActive ? name : activeTool,
              disabled,
              onClick: () => editor.setActiveTool(slotToolId),
              popupSide,
            };

            if (!menuItems) return <ToolButton key={name} {...buttonProps} />;

            return (
              <ToolSplitButton
                key={name}
                {...buttonProps}
                vertical={vertical}
                menuItems={menuItems}
                onMenuItemSelect={(item) => editor.chooseToolMenuItem(name, item.id)}
              />
            );
          })}
      </Toolbar>
    </section>
  );
}
