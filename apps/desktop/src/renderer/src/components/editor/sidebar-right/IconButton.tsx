import { Button, cn, Tooltip } from "@shift/ui";

type IconButtonProps = {
  ariaLabel: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  onClick: () => void;
  disabled?: boolean;
  shortcut?: string;
  className?: string;
};

export const IconButton = ({
  ariaLabel,
  icon: Icon,
  onClick,
  disabled,
  shortcut,
  className,
}: IconButtonProps) => (
  <Tooltip
    content={
      <>
        {ariaLabel}
        {shortcut ? (
          <kbd className="ml-2 font-sans text-on-surface-inverse/70">{shortcut}</kbd>
        ) : null}
      </>
    }
  >
    <Button
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      className={cn(
        "h-6 w-6 bg-icon-button p-1 text-sidebar-icon hover:bg-icon-button-hover",
        className,
      )}
      variant="ghost"
      onClick={() => {
        if (disabled) return;

        onClick();
      }}
    >
      <Icon className="w-full h-full" />
    </Button>
  </Tooltip>
);
