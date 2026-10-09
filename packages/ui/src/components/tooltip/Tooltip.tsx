import * as React from "react";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { cn } from "../../lib/utils";
import { usePortalContainer } from "../portal";

interface TooltipProviderProps {
  children: React.ReactNode;
  delayDuration?: number;
}

function TooltipProvider({ children, delayDuration = 0 }: TooltipProviderProps) {
  return <BaseTooltip.Provider delay={delayDuration}>{children}</BaseTooltip.Provider>;
}

type TooltipProps = {
  delayDuration?: number;
} & (
  | {
      /** `TooltipTrigger` and `TooltipContent` parts. */
      children: React.ReactNode;
      content?: undefined;
    }
  | ({
      /** The element the tooltip describes; it becomes the trigger. */
      children: React.ReactElement<Record<string, unknown>>;
      /** What the tooltip says, usually the action's name. */
      content: React.ReactNode;
    } & Pick<TooltipContentProps, "side" | "sideOffset">)
);

/**
 * A hover and focus tooltip.
 *
 * @remarks
 * With `content`, the child is the trigger and the tooltip renders its own
 * parts: `<Tooltip content="Close"><Button … /></Tooltip>`. Without it, compose
 * `TooltipTrigger` and `TooltipContent` as children.
 */
function Tooltip(props: TooltipProps) {
  const { delayDuration } = props;
  const parts =
    props.content === undefined ? (
      props.children
    ) : (
      <>
        <TooltipTrigger>{props.children}</TooltipTrigger>
        <TooltipContent side={props.side} sideOffset={props.sideOffset}>
          {props.content}
        </TooltipContent>
      </>
    );

  if (delayDuration !== undefined) {
    return (
      <BaseTooltip.Provider delay={delayDuration}>
        <BaseTooltip.Root>{parts}</BaseTooltip.Root>
      </BaseTooltip.Provider>
    );
  }
  return <BaseTooltip.Root>{parts}</BaseTooltip.Root>;
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
