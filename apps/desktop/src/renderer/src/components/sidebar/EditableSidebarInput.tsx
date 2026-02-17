import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import { cn, Input } from "@shift/ui";
import { NUDGES_VALUES, type NudgeMagnitude } from "@/types/nudge";
import { useFocusZone } from "@/context/FocusZoneContext";

export interface EditableSidebarInputHandle {
  setValue: (value: number) => void;
}

interface EditableSidebarInputProps {
  label?: string | React.ReactNode;
  labelPosition?: "left" | "right";
  className?: string;
  value?: number | null;
  icon?: React.ReactNode;
  iconPosition?: "left" | "right";
  onValueChange?: (value: number) => void;
  disabled?: boolean;
  suffix?: string;
  defaultValue?: number;
}

const parseNumericValue = (input: string): number | null => {
  const cleaned = input.replace(/[^0-9.-]/g, "");
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

export const EditableSidebarInput = forwardRef<
  EditableSidebarInputHandle,
  EditableSidebarInputProps
>(
  (
    {
      label,
      labelPosition,
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
    const { lockToZone, unlock } = useFocusZone();
    const initialValue = value === undefined ? defaultValue : value;
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState("");
    const [displayValue, setDisplayValue] = useState<number | null>(initialValue);
    const inputRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(
      ref,
      () => ({
        setValue: (v: number) => {
          setDisplayValue(v);
        },
      }),
      [],
    );

    useEffect(() => {
      if (!isEditing && value !== undefined) {
        setDisplayValue(value);
      }
    }, [value, isEditing]);

    const handleFocus = useCallback(() => {
      if (disabled) return;
      lockToZone("sidebar");
      setIsEditing(true);
      setEditValue(displayValue === null ? "" : String(displayValue));
    }, [disabled, displayValue, lockToZone]);

    const handleBlur = useCallback(() => {
      unlock();
      setIsEditing(false);
      const numericValue = parseNumericValue(editValue) ?? defaultValue;
      setDisplayValue(numericValue);
      onValueChange?.(numericValue);
    }, [editValue, defaultValue, onValueChange, unlock]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!inputRef.current) return;
        e.nativeEvent.stopImmediatePropagation();

        if (e.key === "Enter") {
          inputRef.current.blur();
          return;
        }

        if (e.metaKey && e.key === "a") {
          inputRef.current.select();
        }

        if (e.key === "Escape") {
          setEditValue(displayValue === null ? "" : String(displayValue));
          setIsEditing(false);
          inputRef.current.blur();
          return;
        }

        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();

          const modifier: NudgeMagnitude = e.metaKey ? "large" : e.shiftKey ? "medium" : "small";
          const step = NUDGES_VALUES[modifier];
          const direction = e.key === "ArrowUp" ? 1 : -1;

          const currentValue = isEditing ? parseNumericValue(editValue) : displayValue;
          if (currentValue === null) return;

          const newValue = currentValue + step * direction;

          if (isEditing) {
            setEditValue(String(newValue));
          }
          onValueChange?.(newValue);
        }
      },
      [isEditing, editValue, displayValue, onValueChange],
    );

    const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      setEditValue(e.target.value);
    }, []);

    return (
      <Input
        ref={inputRef}
        label={label}
        labelPosition={labelPosition}
        value={isEditing ? editValue : displayValue === null ? "" : `${displayValue}${suffix}`}
        icon={icon}
        iconPosition={iconPosition}
        readOnly={!isEditing}
        className={cn(
          "w-full bg-[#f3f3f3]",
          label && labelPosition !== "right" && "pl-6",
          label && labelPosition === "right" && "pr-6",
          className,
        )}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onChange={handleChange}
        disabled={disabled}
      />
    );
  },
);

EditableSidebarInput.displayName = "EditableSidebarInput";
