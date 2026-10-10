import { useState } from "react";
import type { KerningPairPosition } from "@shift/editor/model";
import type { GlyphId } from "@shift/types";
import {
  Popover,
  PopoverClose,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTitle,
  PopoverTrigger,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  X,
} from "@shift/ui";
import { GroupsIcon } from "@/components/icons/GroupsIcon";
import { SidebarActionButton } from "@/components/sidebar";
import { GroupView } from "./GroupView";

const EDGE_TABS: ReadonlyArray<{ position: KerningPairPosition; label: string }> = [
  { position: "first", label: "Right" },
  { position: "second", label: "Left" },
];

/**
 * What the panel opens on: a selected pair, whose groups are set against
 * each other in the preview, or one glyph, both of whose edges are shown
 * with nothing to kern them against.
 */
export type KerningGroupsTarget =
  | { readonly kind: "pair"; readonly first: GlyphId; readonly second: GlyphId }
  | { readonly kind: "glyph"; readonly glyphId: GlyphId };

/** The target's glyph at a pair position, whose group a tab opens on. */
function targetGlyph(target: KerningGroupsTarget, position: KerningPairPosition): GlyphId {
  if (target.kind === "glyph") return target.glyphId;
  return position === "first" ? target.first : target.second;
}

/** The glyph a tab's preview sets the members against: the pair's other glyph, if any. */
function targetPartner(target: KerningGroupsTarget, position: KerningPairPosition): GlyphId | null {
  if (target.kind === "glyph") return null;
  return position === "first" ? target.second : target.first;
}

interface KerningGroupsPanelProps {
  readonly target: KerningGroupsTarget;
  /** The sidebar block the panel opens beside, flush with its left edge and top. */
  readonly anchorRef: React.RefObject<HTMLElement | null>;
}

/**
 * The font's kerning groups, in a panel flush with the sidebar, opening on
 * the target's groups: right-edge or left-edge groups, the one shown (any
 * can be picked), its members (set against a pair's other glyph at the
 * current kern), and the members to add to or remove from.
 */
export function KerningGroupsPanel({ target, anchorRef }: KerningGroupsPanelProps) {
  const targetKey =
    target.kind === "pair" ? `${target.first}:${target.second}` : `glyph:${target.glyphId}`;
  const [position, setPosition] = useState<KerningPairPosition>("first");

  return (
    <Popover modal={false}>
      <Tooltip>
        <TooltipTrigger>
          <PopoverTrigger
            render={
              <SidebarActionButton label="Kerning groups">
                <GroupsIcon aria-hidden className="h-4 w-4" />
              </SidebarActionButton>
            }
          />
        </TooltipTrigger>
        <TooltipContent>Kerning groups</TooltipContent>
      </Tooltip>
      <PopoverPortal>
        {/* Its right border on the sidebar's border, its top on the divider above the anchor. */}
        <PopoverPositioner
          anchor={anchorRef}
          side="left"
          align="start"
          sideOffset={-1}
          alignOffset={-1}
        >
          <PopoverPopup className="relative flex w-72 flex-col p-0">
            <div className="flex h-8 items-center justify-between border-b border-line-subtle px-2">
              <PopoverTitle>Kerning groups</PopoverTitle>
              <Tooltip>
                <TooltipTrigger>
                  <PopoverClose variant="icon" aria-label="Close">
                    <X className="h-4 w-4" />
                  </PopoverClose>
                </TooltipTrigger>
                <TooltipContent>Close</TooltipContent>
              </Tooltip>
            </div>
            <Tabs
              value={position}
              onValueChange={(value) => setPosition(value as KerningPairPosition)}
            >
              <div className="border-b border-line-subtle px-2 py-1.5">
                <TabsList variant="pill">
                  {EDGE_TABS.map((tab) => (
                    <TabsTab key={tab.position} value={tab.position} variant="pill">
                      {tab.label}
                    </TabsTab>
                  ))}
                </TabsList>
              </div>
              {EDGE_TABS.map((tab) => (
                <TabsPanel key={tab.position} value={tab.position}>
                  <GroupView
                    key={targetKey}
                    position={tab.position}
                    glyphId={targetGlyph(target, tab.position)}
                    otherGlyphId={targetPartner(target, tab.position)}
                  />
                </TabsPanel>
              ))}
            </Tabs>
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  );
}
