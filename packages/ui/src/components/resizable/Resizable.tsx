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
};
export type ResizablePanelHandle = ImperativePanelHandle;

export const ResizablePanelGroup = ({
  className,
  ...props
}: ResizablePanelGroupProps) => (
  <PanelGroup
    className={cn(
      "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
      className,
    )}
    {...props}
  />
);

export const ResizablePanel = Panel;

export const ResizableHandle = ({
  className,
  withVisual = false,
  ...props
}: ResizableHandleProps) => (
  <PanelResizeHandle
    className={cn(
      "relative flex items-center justify-center bg-transparent transition-colors",
      "data-[panel-group-direction=horizontal]:w-1 data-[panel-group-direction=horizontal]:cursor-col-resize",
      "data-[panel-group-direction=vertical]:h-1 data-[panel-group-direction=vertical]:cursor-row-resize",
      "hover:bg-line data-[resize-handle-state=drag]:bg-accent data-[resize-handle-state=hover]:bg-line",
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
