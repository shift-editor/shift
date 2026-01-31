import * as React from "react";
import { Tooltip as BaseTooltip } from "@base-ui-components/react/tooltip";
import { cn } from "@shift/ui";

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
  children: React.ReactNode;
}

function TooltipTrigger({ children }: TooltipTriggerProps) {
  return <BaseTooltip.Trigger render={<span />}>{children}</BaseTooltip.Trigger>;
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
  sideOffset = 0,
}: TooltipContentProps) {
  return (
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner side={side} sideOffset={sideOffset}>
        <BaseTooltip.Popup
          className={cn(
            "z-50 rounded-md bg-surface px-3 py-1.5 text-xs text-primary border shadow-sm",
            "animate-in fade-in-0 zoom-in-95",
            className,
          )}
        >
          {children}
        </BaseTooltip.Popup>
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
