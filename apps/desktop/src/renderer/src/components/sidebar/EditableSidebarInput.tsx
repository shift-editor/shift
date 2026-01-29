import { useState, useRef, useEffect, useCallback } from "react";
import { cn, Input } from "@shift/ui";
import { NUDGES_VALUES, type NudgeMagnitude } from "@/types/nudge";

interface EditableSidebarInputProps {
  label?: string | React.ReactNode;
  className?: string;
  value: number;
  icon?: React.ReactNode;
  iconPosition?: "left" | "right";
  onValueChange?: (value: number) => void;
  disabled?: boolean;
  suffix?: string;
  defaultValue?: number;
}

const parseNumericValue = (input: string): number | null => {
  const cleaned = input.replace(/[^0-9.\-]/g, "");
  const parsed = parseFloat(cleaned);
  return Number.isNaN(parsed) ? null : parsed;
};

export const EditableSidebarInput = ({
  label,
  className,
  value,
  icon,
  iconPosition,
  onValueChange,
  disabled = false,
  suffix,
  defaultValue,
}: EditableSidebarInputProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState<string>(String(value));
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
    const numericValue = parseNumericValue(editValue) ?? defaultValue ?? 0;
    onValueChange?.(numericValue);
  }, [editValue, defaultValue, onValueChange]);
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!inputRef.current) return;

      if (e.key === "Enter") {
        inputRef.current.blur();
        setEditValue(String(value));
      }

      if (e.metaKey && e.key === "a") {
        inputRef.current.select();
      }

      if (e.key === "Escape") {
        setEditValue(String(value));
        setIsEditing(false);
        inputRef.current.blur();
        return;
      }

      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();

        const modifier: NudgeMagnitude = e.metaKey ? "large" : e.shiftKey ? "medium" : "small";
        const step = NUDGES_VALUES[modifier];
        const direction = e.key === "ArrowUp" ? 1 : -1;

        const currentValue = isEditing ? parseNumericValue(editValue) : value;
        if (currentValue === null) return;

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
      value={isEditing ? editValue : `${value}${suffix ?? ""}`}
      icon={icon}
      iconPosition={iconPosition}
      readOnly={!isEditing}
      className={cn("w-full bg-[#f3f3f3]", label && "pl-6", className)}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onChange={handleChange}
      disabled={disabled}
    />
  );
};
