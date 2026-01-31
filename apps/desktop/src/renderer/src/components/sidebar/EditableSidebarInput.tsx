import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import { cn, Input } from "@shift/ui";
import { NUDGES_VALUES, type NudgeMagnitude } from "@/types/nudge";

export interface EditableSidebarInputHandle {
  setValue: (value: number) => void;
}

interface EditableSidebarInputProps {
  label?: string | React.ReactNode;
  className?: string;
  value?: number;
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

export const EditableSidebarInput = forwardRef<
  EditableSidebarInputHandle,
  EditableSidebarInputProps
>(
  (
    {
      label,
      className,
      value,
      icon,
      iconPosition,
      onValueChange,
      disabled = false,
      suffix = "",
      defaultValue = 0,
    },
    ref,
  ) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const displayValueRef = useRef(value ?? defaultValue);

    useImperativeHandle(
      ref,
      () => ({
        setValue: (v: number) => {
          displayValueRef.current = v;
          if (inputRef.current && !isEditing) {
            inputRef.current.value = `${v}${suffix}`;
          }
        },
      }),
      [isEditing, suffix],
    );

    useEffect(() => {
      if (!isEditing && value !== undefined) {
        displayValueRef.current = value;
        if (inputRef.current) {
          inputRef.current.value = `${value}${suffix}`;
        }
      }
    }, [value, isEditing, suffix]);

    const handleFocus = useCallback(() => {
      if (disabled) return;
      setIsEditing(true);
      setEditValue(String(displayValueRef.current));
    }, [disabled]);

    const handleBlur = useCallback(() => {
      setIsEditing(false);
      const numericValue = parseNumericValue(editValue) ?? defaultValue;
      onValueChange?.(numericValue);
    }, [editValue, defaultValue, onValueChange]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!inputRef.current) return;

        if (e.key === "Enter") {
          inputRef.current.blur();
          return;
        }

        if (e.metaKey && e.key === "a") {
          inputRef.current.select();
        }

        if (e.key === "Escape") {
          setEditValue(String(displayValueRef.current));
          setIsEditing(false);
          inputRef.current.blur();
          return;
        }

        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();

          const modifier: NudgeMagnitude = e.metaKey ? "large" : e.shiftKey ? "medium" : "small";
          const step = NUDGES_VALUES[modifier];
          const direction = e.key === "ArrowUp" ? 1 : -1;

          const currentValue = isEditing ? parseNumericValue(editValue) : displayValueRef.current;
          if (currentValue === null) return;

          const newValue = currentValue + step * direction;

          if (isEditing) {
            setEditValue(String(newValue));
          }
          onValueChange?.(newValue);
        }
      },
      [isEditing, editValue, onValueChange],
    );

    const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      setEditValue(e.target.value);
    }, []);

    return (
      <Input
        ref={inputRef}
        label={label}
        defaultValue={`${displayValueRef.current}${suffix}`}
        value={isEditing ? editValue : undefined}
        icon={icon}
        iconPosition={iconPosition}
        readOnly={!isEditing}
        className={cn("w-full bg-[#f3f3f3]", label && "pl-6", className)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onChange={isEditing ? handleChange : undefined}
        disabled={disabled}
      />
    );
  },
);

EditableSidebarInput.displayName = "EditableSidebarInput";
