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
  subject,
  onClick,
}: OutlineVisibilityButtonProps) => {
  const [showInheritedIndicator, setShowInheritedIndicator] = useState(inherited);
  const [showVisibleIndicator, setShowVisibleIndicator] = useState(visible);
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

  useEffect(() => {
    if (visible) {
      setShowVisibleIndicator(true);
      return;
    }
    if (!showVisibleIndicator) return;

    const timeout = setTimeout(() => setShowVisibleIndicator(false), 200);
    return () => clearTimeout(timeout);
  }, [showVisibleIndicator, visible]);

  return (
    <Tooltip>
      <TooltipTrigger>
        <SidebarActionButton
          label={subject ? `${action} for ${subject}` : action}
          onClick={() => {
            if (inherited) setShowInheritedIndicator(false);
            if (visible) setShowVisibleIndicator(false);
            onClick();
          }}
          onTransitionEnd={(event) => {
            if (event.propertyName !== "opacity" || visible || alwaysOpen) return;
            if (getComputedStyle(event.currentTarget).opacity !== "0") return;

            setShowInheritedIndicator(false);
            setShowVisibleIndicator(false);
          }}
          className={visible ? "!opacity-100" : undefined}
        >
          {showInheritedIndicator ? (
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary" />
          ) : visible || showVisibleIndicator || alwaysOpen ? (
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
