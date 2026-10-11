import {
  Group,
  Panel,
  Separator,
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

const lineAnchor = (inset: ResizableHandleProps["inset"]): string => {
  switch (inset) {
    case "start":
      return "aria-[orientation=vertical]:after:right-1/2 aria-[orientation=horizontal]:after:bottom-1/2";
    case "end":
      return "aria-[orientation=vertical]:after:left-1/2 aria-[orientation=horizontal]:after:top-1/2";
    default:
      return "aria-[orientation=vertical]:after:left-[calc(50%-1px)] aria-[orientation=horizontal]:after:top-[calc(50%-1px)]";
  }
};

export const ResizableHandle = ({ className, inset, ...props }: ResizableHandleProps) => (
  <Separator
    className={cn(
      // Above the editor canvas stack (z-20) so the half of the grab area that overlaps the
      // neighbouring panel still receives the pointer.
      "relative z-30 shrink-0 outline-none select-none",
      "aria-[orientation=vertical]:-mx-2 aria-[orientation=vertical]:w-4 aria-[orientation=vertical]:cursor-col-resize",
      "aria-[orientation=horizontal]:-my-2 aria-[orientation=horizontal]:h-4 aria-[orientation=horizontal]:cursor-row-resize",
      "after:absolute after:transition-colors after:content-['']",
      "aria-[orientation=vertical]:after:inset-y-0 aria-[orientation=vertical]:after:w-0.5",
      "aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:h-0.5",
      lineAnchor(inset),
      "data-[separator=hover]:after:bg-accent/80 data-[separator=focus]:after:bg-accent/80 data-[separator=active]:after:bg-accent",
      className,
    )}
    {...props}
  />
);
