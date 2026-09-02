import { Button, Tooltip, TooltipContent, TooltipTrigger, cn } from "@shift/ui";

type IconButtonProps = {
  ariaLabel: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  onClick: () => void;
  disabled?: boolean;
};

export const IconButton = ({ ariaLabel, icon: Icon, onClick, disabled }: IconButtonProps) => (
  <Tooltip>
    <TooltipTrigger>
      <Button
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
        className={cn(
          "h-6 w-6 p-1 text-sidebar-icon bg-icon-button hover:bg-icon-button-hover",
          disabled && "cursor-default opacity-50",
        )}
        variant="ghost"
        onClick={() => {
          if (disabled) return;

          onClick();
        }}
      >
        <Icon className="w-full h-full" />
      </Button>
    </TooltipTrigger>
    <TooltipContent>{ariaLabel}</TooltipContent>
  </Tooltip>
);
