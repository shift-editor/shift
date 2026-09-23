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

export interface ToolsPaneProps {
  editor: Editor;
}

interface ToolButtonProps {
  Icon: SVGIcon;
  iconName?: ShiftIconName;
  name: ToolName;
  tooltip: string;
  activeTool: ToolName | null;
  disabled?: boolean;
  onClick?: () => void;
}

interface ToolSplitButtonProps extends ToolButtonProps {
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
}: ToolButtonProps) {
  const isActive = activeTool === name;

  return (
    <Tooltip>
      <TooltipTrigger>
        <ToolbarButton
          render={
            <Button
              className="h-8 w-8 rounded-md transition-none focus-visible:ring-0"
              variant={isActive ? "primary" : "ghost"}
              icon={
                iconName ? (
                  <ShiftIcon name={iconName} className="h-5.5 w-5.5" />
                ) : (
                  <Icon
                    className={cn("h-5.5 w-5.5", isActive ? "text-white" : "text-primary")}
                    strokeWidth={1.25}
                  />
                )
              }
              aria-label={tooltip}
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
      <TooltipContent side="bottom" sideOffset={5}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function ToolSplitButton({ menuItems, onMenuItemSelect, ...buttonProps }: ToolSplitButtonProps) {
  return (
    <ToolbarGroup className="flex items-center gap-0.5">
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
                  className="h-8 w-4 rounded-sm focus-visible:ring-0 data-[popup-open]:bg-hover/50"
                  icon={<ChevronDown className="h-3.5 w-3.5 text-primary" strokeWidth={1.5} />}
                  aria-label={`${buttonProps.tooltip} options`}
                  disabled={buttonProps.disabled}
                />
              }
            />
          }
        />
        <MenuPortal>
          <MenuPositioner align="start" sideOffset={4}>
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
                        className="h-5 w-5"
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

export function ToolsPane({ editor }: ToolsPaneProps) {
  const activeTool = useSignalState(editor.toolCell)?.id ?? null;
  const toolRegistry = useSignalState(editor.toolRegistryCell);

  return (
    <section className="flex flex-col items-center justify-center gap-2">
      <Toolbar
        aria-label="Editor tools"
        className="flex h-[40px] items-center gap-2 overflow-hidden rounded-lg bg-white px-1"
      >
        {Array.from(toolRegistry.entries())
          .filter(([, item]) => !item.hidden)
          .map(([name, { icon, tooltip, menuItems, disabled }]) => {
            const iconName: ShiftIconName | undefined =
              name === "select" || name === "pen" || name === "hand" || name === "shape"
                ? name
                : undefined;
            const buttonProps = {
              Icon: icon,
              iconName,
              name,
              tooltip,
              activeTool,
              disabled,
              onClick: () => editor.setActiveTool(name),
            };

            if (!menuItems) return <ToolButton key={name} {...buttonProps} />;

            return (
              <ToolSplitButton
                key={name}
                {...buttonProps}
                menuItems={menuItems}
                onMenuItemSelect={(item) => {
                  item.onSelect();
                  editor.setActiveTool(name);
                }}
              />
            );
          })}
      </Toolbar>
    </section>
  );
}
