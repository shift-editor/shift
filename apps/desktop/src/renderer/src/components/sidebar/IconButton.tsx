import { Button } from "@shift/ui";

type IconButtonProps = {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  onClick: () => void;
};

export const IconButton = ({ icon: Icon, onClick }: IconButtonProps) => (
  <Button
    className="h-6 w-6 p-0.5 bg-icon-button hover:bg-icon-button-hover"
    variant="ghost"
    onClick={onClick}
  >
    <Icon className="w-3/4 h-3/4" />
  </Button>
);
