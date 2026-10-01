import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type ImperativePanelHandle,
  type PanelGroupProps,
  type PanelProps,
  type PanelResizeHandleProps,
} from "react-resizable-panels";
import { cn } from "../../lib/utils";

export type ResizablePanelGroupProps = PanelGroupProps;
export type ResizablePanelProps = PanelProps;
export type ResizableHandleProps = PanelResizeHandleProps & {
  withVisual?: boolean;
  inset?: "start" | "end";
};
export type ResizablePanelHandle = ImperativePanelHandle;

export const ResizablePanelGroup = ({ className, ...props }: ResizablePanelGroupProps) => (
  <PanelGroup
    className={cn("flex h-full w-full data-[panel-group-direction=vertical]:flex-col", className)}
    {...props}
  />
);

export const ResizablePanel = Panel;

export const ResizableHandle = ({
  className,
  withVisual = false,
  inset,
  hitAreaMargins,
  ...props
}: ResizableHandleProps) => {
  if (inset) {
    const stripAnchor =
      inset === "start"
        ? "data-[panel-group-direction=horizontal]:after:right-1/2 data-[panel-group-direction=vertical]:after:bottom-1/2"
        : "data-[panel-group-direction=horizontal]:after:left-1/2 data-[panel-group-direction=vertical]:after:top-1/2";

    return (
      <PanelResizeHandle
        hitAreaMargins={hitAreaMargins ?? { coarse: 0, fine: 0 }}
        className={cn(
          "relative z-10 shrink-0 transition-colors",
          "data-[panel-group-direction=horizontal]:-mx-2 data-[panel-group-direction=horizontal]:w-4 data-[panel-group-direction=horizontal]:cursor-col-resize",
          "data-[panel-group-direction=vertical]:-my-2 data-[panel-group-direction=vertical]:h-4 data-[panel-group-direction=vertical]:cursor-row-resize",
          "after:content-[''] after:absolute after:transition-colors",
          "data-[panel-group-direction=horizontal]:after:inset-y-0 data-[panel-group-direction=horizontal]:after:w-0.5",
          "data-[panel-group-direction=vertical]:after:inset-x-0 data-[panel-group-direction=vertical]:after:h-1",
          stripAnchor,
          "hover:after:bg-accent/90 data-[resize-handle-state=drag]:after:bg-accent data-[resize-handle-state=hover]:after:bg-accent/80",
          className,
        )}
        {...props}
      />
    );
  }

  return (
    <PanelResizeHandle
      hitAreaMargins={hitAreaMargins}
      className={cn(
        "relative flex items-center justify-center bg-transparent transition-colors",
        "data-[panel-group-direction=horizontal]:w-0.5 data-[panel-group-direction=horizontal]:cursor-col-resize",
        "data-[panel-group-direction=vertical]:h-1 data-[panel-group-direction=vertical]:cursor-row-resize",
        "hover:bg-accent/90 data-[resize-handle-state=drag]:bg-accent data-[resize-handle-state=hover]:bg-accent/80",
        className,
      )}
      {...props}
    >
      {withVisual ? (
        <div
          className={cn(
            "rounded-full bg-line-subtle",
            "data-[panel-group-direction=horizontal]:h-8 data-[panel-group-direction=horizontal]:w-0.5",
            "data-[panel-group-direction=vertical]:h-0.5 data-[panel-group-direction=vertical]:w-8",
          )}
        />
      ) : null}
    </PanelResizeHandle>
  );
};
