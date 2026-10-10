import * as React from "react";
import { Tooltip as BaseTooltip } from "@base-ui-components/react/tooltip";
import { cn } from "../../lib/utils";
import { usePortalContainer } from "../portal";

interface TooltipProviderProps {
  children: React.ReactNode;
  delayDuration?: number;
}

function TooltipProvider({ children, delayDuration = 0 }: TooltipProviderProps) {
  return <BaseTooltip.Provider delay={delayDuration}>{children}</BaseTooltip.Provider>;
}

interface TooltipProps {
  children: React.ReactNode;
  delayDuration?: number;
  /** Keeps the tooltip from opening, such as when the text it repeats is shown in full. */
  disabled?: boolean;
}

function Tooltip({ children, delayDuration, disabled }: TooltipProps) {
  if (delayDuration !== undefined) {
    return (
      <BaseTooltip.Provider delay={delayDuration}>
        <BaseTooltip.Root disabled={disabled}>{children}</BaseTooltip.Root>
      </BaseTooltip.Provider>
    );
  }
  return <BaseTooltip.Root disabled={disabled}>{children}</BaseTooltip.Root>;
}

interface TooltipTriggerProps {
  children: React.ReactElement<Record<string, unknown>>;
}

function TooltipTrigger({ children }: TooltipTriggerProps) {
  return <BaseTooltip.Trigger render={children} />;
}

interface TooltipContentProps {
  children: React.ReactNode;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
  sideOffset?: number;
}

function TooltipContent({
  children,
  className,
  side = "top",
  sideOffset = 5,
}: TooltipContentProps) {
  const container = usePortalContainer();
  return (
    <BaseTooltip.Portal container={container}>
      <BaseTooltip.Positioner side={side} sideOffset={sideOffset}>
        <BaseTooltip.Popup
          role="tooltip"
          className={cn(
            "relative z-50 rounded-md bg-surface-inverse px-3 py-1.5 text-ui text-on-surface-inverse shadow-lg",
            className,
          )}
        >
          <BaseTooltip.Arrow
            className={cn(
              "relative block h-1.5 w-3 overflow-clip",
              "data-[side=bottom]:-top-1.5 data-[side=left]:-right-2.25 data-[side=left]:rotate-90",
              "data-[side=right]:-left-2.25 data-[side=right]:-rotate-90",
              "data-[side=top]:-bottom-1.5 data-[side=top]:rotate-180",
              "before:absolute before:bottom-0 before:left-1/2 before:size-[calc(6px*sqrt(2))]",
              "before:bg-surface-inverse before:content-['']",
              "before:[transform:translate(-50%,50%)_rotate(45deg)]",
            )}
          />
          {children}
        </BaseTooltip.Popup>
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
