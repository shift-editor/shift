import { useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@shift/ui";
import { CollapsibleSection, SidebarActionButton } from "@/components/sidebar";
import { CreateSourceMenu } from "./CreateSourceMenu";
import { Sources } from "./Sources";
import { OutlineVisibilityButton } from "./OutlineVisibilityButton";
import { useSources } from "@/hooks/useSources";
import type { GlyphOutlineControls, GlyphOutlineTarget } from "@/types/glyphOutline";
import { useFontSession } from "@/workspace/WorkspaceContext";
import PlusIcon from "@/assets/general/plus.svg";

interface SourcesSectionProps {
  defaultOpen?: boolean;
  outlineControls?: GlyphOutlineControls;
}

export const SourcesSection = ({ defaultOpen = false, outlineControls }: SourcesSectionProps) => {
  const [open, setOpen] = useState(defaultOpen);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const canAuthor = useFontSession().mode === "authored";
  const sources = useSources();
  const sourceTargets: GlyphOutlineTarget[] = sources.map((source) => ({
    kind: "source",
    sourceId: source.id,
  }));
  const allVisible =
    sourceTargets.length > 0 &&
    sourceTargets.every((target) => {
      if (target.kind !== "source") return false;

      return outlineControls?.targets.some(
        (visible) => visible.kind === "source" && visible.sourceId === target.sourceId,
      );
    });

  const toggleAll = () => {
    if (!outlineControls) return;

    outlineControls.onChange(allVisible ? [] : sourceTargets);
  };

  return (
    <CollapsibleSection
      title="Sources"
      open={open || sourceMenuOpen}
      onOpenChange={setOpen}
      isActive={sourceMenuOpen}
      actions={
        <>
          {outlineControls && sourceTargets.length > 0 && (
            <OutlineVisibilityButton
              visible={allVisible}
              alwaysOpen
              label="all source outlines"
              onClick={toggleAll}
            />
          )}
          {canAuthor ? (
            <CreateSourceMenu onOpenChange={setSourceMenuOpen} />
          ) : (
            <Tooltip>
              <TooltipTrigger>
                <SidebarActionButton label="Create source" aria-disabled>
                  <PlusIcon className="h-3 w-3" />
                </SidebarActionButton>
              </TooltipTrigger>
              <TooltipContent>Create source</TooltipContent>
            </Tooltip>
          )}
        </>
      }
    >
      <Sources canAuthor={canAuthor} outlineControls={outlineControls} />
    </CollapsibleSection>
  );
};
