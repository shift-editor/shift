import { Tooltip, TooltipContent, TooltipTrigger } from "@shift/ui";
import { useEffect, useState } from "react";
import { SidebarActionButton } from "@/components/sidebar";
import EyeClosedIcon from "@/assets/general/eye-closed.svg";
import EyeOpenIcon from "@/assets/general/eye-open.svg";
import type { OutlineVisibilityButtonProps } from "./types";

export const OutlineVisibilityButton = ({
  visible,
  alwaysOpen = false,
  label,
  onClick,
}: OutlineVisibilityButtonProps) => {
  const [showOpenIcon, setShowOpenIcon] = useState(visible || alwaysOpen);
  const action = `${visible ? "Hide" : "Show"} ${label}`;

  useEffect(() => {
    if (visible || alwaysOpen) setShowOpenIcon(true);
  }, [alwaysOpen, visible]);

  return (
    <Tooltip>
      <TooltipTrigger>
        <SidebarActionButton
          label={action}
          onClick={onClick}
          onTransitionEnd={(event) => {
            if (event.propertyName !== "opacity" || visible || alwaysOpen) return;
            if (getComputedStyle(event.currentTarget).opacity !== "0") return;

            setShowOpenIcon(false);
          }}
          className={visible ? "!opacity-100" : undefined}
        >
          {showOpenIcon ? (
            <EyeOpenIcon aria-hidden className="h-4 w-4" />
          ) : (
            <EyeClosedIcon aria-hidden className="h-4 w-4" />
          )}
        </SidebarActionButton>
      </TooltipTrigger>
      <TooltipContent>{action}</TooltipContent>
    </Tooltip>
  );
};
