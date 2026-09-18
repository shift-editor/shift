import { useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@shift/ui";
import { CollapsibleSection, SidebarActionButton } from "@/components/sidebar";
import { CreateInstanceMenu } from "./CreateInstanceMenu";
import { Instances } from "./Instances";
import { OutlineVisibilityButton } from "./OutlineVisibilityButton";
import { useNamedInstances } from "@/hooks/useNamedInstances";
import type { GlyphOutlineControls, GlyphOutlineTarget } from "@/types/glyphOutline";
import { useFontSession } from "@/workspace/WorkspaceContext";
import PlusIcon from "@/assets/general/plus.svg";

interface InstancesSectionProps {
  defaultOpen?: boolean;
  outlineControls?: GlyphOutlineControls;
}

export const InstancesSection = ({
  defaultOpen = false,
  outlineControls,
}: InstancesSectionProps) => {
  const [open, setOpen] = useState(defaultOpen);
  const [instanceMenuOpen, setInstanceMenuOpen] = useState(false);
  const canAuthor = useFontSession().mode === "authored";
  const instances = useNamedInstances();
  const instanceTargets: GlyphOutlineTarget[] = instances.map((instance) => ({
    kind: "instance",
    instanceId: instance.id,
  }));
  const allVisible =
    instanceTargets.length > 0 &&
    instanceTargets.every((target) => {
      if (target.kind !== "instance") return false;

      return outlineControls?.targets.some(
        (visible) => visible.kind === "instance" && visible.instanceId === target.instanceId,
      );
    });

  const toggleAll = () => {
    if (!outlineControls) return;

    const sources = outlineControls.targets.filter((target) => target.kind === "source");
    outlineControls.onChange(allVisible ? sources : [...sources, ...instanceTargets]);
  };

  return (
    <CollapsibleSection
      title="Instances"
      open={open || instanceMenuOpen}
      onOpenChange={setOpen}
      isActive={instanceMenuOpen}
      actions={
        <>
          {outlineControls && instanceTargets.length > 0 && (
            <OutlineVisibilityButton
              visible={allVisible}
              alwaysOpen
              label="all instance outlines"
              onClick={toggleAll}
            />
          )}
          {canAuthor ? (
            <CreateInstanceMenu onOpenChange={setInstanceMenuOpen} />
          ) : (
            <Tooltip>
              <TooltipTrigger>
                <SidebarActionButton label="Create instance" aria-disabled>
                  <PlusIcon className="h-3 w-3" />
                </SidebarActionButton>
              </TooltipTrigger>
              <TooltipContent>Create instance</TooltipContent>
            </Tooltip>
          )}
        </>
      }
    >
      <Instances canAuthor={canAuthor} outlineControls={outlineControls} />
    </CollapsibleSection>
  );
};
