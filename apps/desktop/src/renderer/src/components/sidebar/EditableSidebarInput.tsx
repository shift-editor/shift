import { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@shift/ui";

interface EditableSidebarInputProps {
  label?: string;
  value: string | number;
  icon?: React.ReactNode;
  iconPosition?: "left" | "right";
  onValueChange?: (value: number) => void;
  disabled?: boolean;
}

export const EditableSidebarInput = ({
  label,
  value,
  icon,
  iconPosition,
  onValueChange,
  disabled = false,
}: EditableSidebarInputProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) {
      setEditValue(String(value));
    }
  }, [value, isEditing]);

  const handleFocus = useCallback(() => {
    if (disabled) return;
    setIsEditing(true);
    setEditValue(String(value));
  }, [disabled, value]);

  const handleBlur = useCallback(() => {
    setIsEditing(false);
    const numValue = parseFloat(editValue);
    if (!isNaN(numValue) && onValueChange) {
      onValueChange(numValue);
    }
  }, [editValue, onValueChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        inputRef.current?.blur();
      } else if (e.key === "Escape") {
        setEditValue(String(value));
        setIsEditing(false);
        inputRef.current?.blur();
      }
    },
    [value],
  );

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setEditValue(e.target.value);
  }, []);

  return (
    <Input
      ref={inputRef}
      label={label}
      value={isEditing ? editValue : value}
      icon={icon}
      iconPosition={iconPosition}
      readOnly={!isEditing}
      className="w-full"
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onChange={handleChange}
      disabled={disabled}
    />
  );
};
