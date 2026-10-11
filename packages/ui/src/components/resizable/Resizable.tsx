import {
  Group,
  Panel,
  Separator as PanelSeparator,
  type GroupProps,
  type PanelImperativeHandle,
  type PanelProps,
  type SeparatorProps,
} from "react-resizable-panels";
import { cn } from "../../lib/utils";

export type ResizablePanelGroupProps = GroupProps;
export type ResizablePanelProps = PanelProps;
export type ResizablePanelHandle = PanelImperativeHandle;
export type ResizableHandleProps = SeparatorProps & {
  /** Which side of the 16px grab area draws the divider line, so it sits on the panel edge. */
  inset?: "start" | "end";
};

export const ResizablePanelGroup = ({ className, ...props }: ResizablePanelGroupProps) => (
  <Group className={cn("h-full w-full", className)} {...props} />
);

// Panel content manages its own scrolling. The library's default `overflow: auto` draws a
// scrollbar whenever content briefly overflows, such as while a sidebar animates.
export const ResizablePanel = ({ style, ...props }: ResizablePanelProps) => (
  <Panel style={{ overflow: "hidden", ...style }} {...props} />
);

const lineAnchor = {
  start: "right-1/2",
  end: "left-1/2",
  center: "left-[calc(50%-1px)]",
};

/** A divider between side-by-side panels: a 16px grab area drawing a 2px line. */
export const ResizableHandle = ({ className, inset, ...props }: ResizableHandleProps) => (
  <PanelSeparator
    className={cn(
      // Above the editor canvas stack (z-20) so the half of the grab area that overlaps the
      // neighbouring panel still receives the pointer.
      "group relative z-30 -mx-2 w-4 shrink-0 cursor-col-resize select-none",
      className,
    )}
    {...props}
  >
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-y-0 w-0.5 transition-colors",
        lineAnchor[inset ?? "center"],
        "group-data-[separator=hover]:bg-accent/80 group-data-[separator=focus]:bg-accent/80 group-data-[separator=active]:bg-accent",
      )}
    />
  </PanelSeparator>
);
