import * as React from "react";
import { ScrollArea as BaseScrollArea } from "@base-ui/react/scroll-area";
import { cn } from "../../lib/utils";

export interface ScrollAreaProps extends Omit<
  React.ComponentProps<typeof BaseScrollArea.Root>,
  "children" | "onScroll"
> {
  children: React.ReactNode;
  /** The element that scrolls, for callers that read or set its scroll position. */
  viewportRef?: React.Ref<HTMLDivElement>;
  viewportStyle?: React.CSSProperties;
  onScroll?: React.UIEventHandler<HTMLDivElement>;
}

/**
 * A vertically scrolling region whose scrollbar is drawn over its content.
 *
 * @remarks
 * A native classic scrollbar takes width, so a panel reflows the moment its
 * content overflows. This one never takes width, and only when the content
 * overflows does it show: while the region scrolls, or while the pointer is
 * over the bar, so it can be dragged. It sits above sticky section headings.
 * Give the root a height, for example `h-full` or `min-h-0 flex-1`.
 */
export function ScrollArea({
  children,
  className,
  viewportRef,
  viewportStyle,
  onScroll,
  ...props
}: ScrollAreaProps) {
  return (
    <BaseScrollArea.Root className={cn("relative min-h-0 overflow-hidden", className)} {...props}>
      <BaseScrollArea.Viewport
        ref={viewportRef}
        className="h-full w-full overscroll-contain"
        style={viewportStyle}
        onScroll={onScroll}
      >
        {children}
      </BaseScrollArea.Viewport>
      <BaseScrollArea.Scrollbar
        orientation="vertical"
        className="absolute top-0.5 right-0.5 bottom-0.5 z-20 hidden w-1.5 justify-center opacity-0 transition-opacity duration-150 hover:opacity-100 data-[has-overflow-y]:flex data-[scrolling]:opacity-100"
      >
        <BaseScrollArea.Thumb className="w-full rounded-full bg-control-muted" />
      </BaseScrollArea.Scrollbar>
    </BaseScrollArea.Root>
  );
}
