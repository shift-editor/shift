import { Tooltip, TooltipContent, TooltipTrigger } from "@shift/ui";
import { useEffect, useState } from "react";
import { SidebarActionButton } from "@/components/sidebar";
import EyeClosedIcon from "@/assets/general/eye-closed.svg";
import EyeOpenIcon from "@/assets/general/eye-open.svg";
import type { OutlineVisibilityButtonProps } from "./types";

export const OutlineVisibilityButton = ({
  visible,
  inherited = false,
  alwaysOpen = false,
  label,
  onClick,
}: OutlineVisibilityButtonProps) => {
  const [showInheritedIndicator, setShowInheritedIndicator] = useState(inherited);
  const action = `${visible ? "Hide" : "Show"} ${label}`;

  useEffect(() => {
    if (inherited) {
      setShowInheritedIndicator(true);
      return;
    }
    if (visible || !showInheritedIndicator) {
      setShowInheritedIndicator(false);
      return;
    }

    const timeout = setTimeout(() => setShowInheritedIndicator(false), 200);
    return () => clearTimeout(timeout);
  }, [inherited, showInheritedIndicator, visible]);

  return (
    <Tooltip>
      <TooltipTrigger>
        <SidebarActionButton
          label={action}
          onClick={() => {
            if (inherited) setShowInheritedIndicator(false);
            onClick();
          }}
          onTransitionEnd={(event) => {
            if (event.propertyName !== "opacity" || visible || alwaysOpen) return;
            if (getComputedStyle(event.currentTarget).opacity !== "0") return;

            setShowInheritedIndicator(false);
          }}
          className={visible ? "!opacity-100" : undefined}
        >
          {showInheritedIndicator ? (
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary" />
          ) : visible || alwaysOpen ? (
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
