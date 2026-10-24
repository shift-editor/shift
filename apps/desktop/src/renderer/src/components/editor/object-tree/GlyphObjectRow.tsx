import type { ReactNode } from "react";
import {
  Collapsible,
  CollapsibleChevron,
  CollapsiblePanel,
  CollapsibleTrigger,
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuPortal,
  ContextMenuPositioner,
  ContextMenuTrigger,
} from "@shift/ui";
import { SidebarRowButton } from "@/components/sidebar";

interface GlyphObjectRowProps {
  /** The glyph's name. */
  readonly name: string;
  /** A filled SVG path previewing the glyph in a 16 × 16 box. */
  readonly iconPath: string | undefined;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Selects every point of the glyph. */
  readonly onSelect: () => void;
  /** Stops editing the glyph. */
  readonly onClose: () => void;
  readonly children: ReactNode;
}

/**
 * One edited glyph under the objects panel's Glyphs heading: a chevron for
 * its contours, anchors, and components, a preview, and its name, which
 * selects the glyph's points. Its context menu closes the glyph.
 */
export const GlyphObjectRow = ({
  name,
  iconPath,
  open,
  onOpenChange,
  onSelect,
  onClose,
  children,
}: GlyphObjectRowProps) => (
  <Collapsible open={open} onOpenChange={onOpenChange} className="flex flex-col">
    <ContextMenu>
      <ContextMenuTrigger className="contents">
        <div className="flex h-7 items-center gap-1.5 rounded hover:bg-hover">
          <CollapsibleTrigger
            render={
              <SidebarRowButton
                variant="transparent"
                className="w-auto shrink-0 px-1"
                aria-label={open ? `Collapse ${name}` : `Expand ${name}`}
              />
            }
          >
            <CollapsibleChevron />
          </CollapsibleTrigger>
          <button
            type="button"
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left text-ui text-primary"
            onClick={onSelect}
          >
            <svg aria-hidden className="h-4 w-4 shrink-0 text-primary" viewBox="0 0 16 16">
              {iconPath ? <path d={iconPath} fill="currentColor" /> : null}
            </svg>
            <span className="truncate">{name}</span>
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuPortal>
        <ContextMenuPositioner>
          <ContextMenuPopup>
            <ContextMenuItem onClick={onClose}>Close Glyph</ContextMenuItem>
          </ContextMenuPopup>
        </ContextMenuPositioner>
      </ContextMenuPortal>
    </ContextMenu>
    <CollapsiblePanel className="pt-2">
      <div className="flex flex-col gap-2 pl-3">{children}</div>
    </CollapsiblePanel>
  </Collapsible>
);
