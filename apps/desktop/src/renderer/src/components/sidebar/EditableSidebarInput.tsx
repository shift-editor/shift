import { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@shift/ui";
import { NUDGES_VALUES, type NudgeMagnitude } from "@/types/nudge";

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
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();

        const modifier: NudgeMagnitude = e.metaKey ? "large" : e.shiftKey ? "medium" : "small";
        const step = NUDGES_VALUES[modifier];
        const direction = e.key === "ArrowUp" ? 1 : -1;

        const currentValue = parseFloat(isEditing ? editValue : String(value));
        if (isNaN(currentValue)) return;

        const newValue = currentValue + step * direction;

        if (isEditing) {
          setEditValue(String(newValue));
        }
        onValueChange?.(newValue);
      }
    },
    [value, isEditing, editValue, onValueChange],
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
      className="w-full bg-[#f3f3f3]"
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onChange={handleChange}
      disabled={disabled}
    />
  );
};
