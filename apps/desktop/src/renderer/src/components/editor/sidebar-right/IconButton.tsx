import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@shift/ui";

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
        className="h-6 w-6 bg-icon-button p-1 text-sidebar-icon hover:bg-icon-button-hover"
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
