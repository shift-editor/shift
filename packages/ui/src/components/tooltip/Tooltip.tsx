import * as React from "react";
import { Tooltip as BaseTooltip } from "@base-ui-components/react/tooltip";
import { cn } from "../../lib/utils";

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
}

function Tooltip({ children, delayDuration }: TooltipProps) {
  if (delayDuration !== undefined) {
    return (
      <BaseTooltip.Provider delay={delayDuration}>
        <BaseTooltip.Root>{children}</BaseTooltip.Root>
      </BaseTooltip.Provider>
    );
  }
  return <BaseTooltip.Root>{children}</BaseTooltip.Root>;
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
  return (
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner side={side} sideOffset={sideOffset}>
        <BaseTooltip.Popup
          role="tooltip"
          className={cn(
            "relative z-50 rounded-md bg-surface-inverse px-3 py-1.5 text-ui text-on-surface-inverse shadow-lg",
            "animate-in fade-in-0 zoom-in-95",
            className,
          )}
        >
          <BaseTooltip.Arrow
            className={cn(
              "relative block h-1.5 w-3 overflow-clip",
              "data-[side=bottom]:-top-1.5 data-[side=left]:-right-[9px] data-[side=left]:rotate-90",
              "data-[side=right]:-left-[9px] data-[side=right]:-rotate-90",
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
