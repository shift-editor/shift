import { Button } from "@shift/ui";

type IconButtonProps = {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  onClick: () => void;
  disabled?: boolean;
};

export const IconButton = ({ icon: Icon, onClick, disabled }: IconButtonProps) => (
  <Button
    className="h-6 w-6 p-1 text-sidebar-icon bg-icon-button hover:bg-icon-button-hover"
    variant="ghost"
    onClick={onClick}
    disabled={disabled}
  >
    <Icon className="w-full h-full" />
  </Button>
);
