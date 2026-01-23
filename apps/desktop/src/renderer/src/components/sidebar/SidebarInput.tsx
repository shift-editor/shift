import { Input } from "@shift/ui";

interface SidebarInputProps {
  label?: string;
  value: string | number;
  icon?: React.ReactNode;
  iconPosition?: "left" | "right";
}

export const SidebarInput = ({
  label,
  value,
  icon,
  iconPosition,
}: SidebarInputProps) => {
  return (
    <Input
      label={label}
      value={value}
      icon={icon}
      iconPosition={iconPosition}
      readOnly
      className="w-full"
    />
  );
};
