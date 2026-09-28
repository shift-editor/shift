import { cn, Input, Tooltip, TooltipContent, TooltipTrigger } from "@shift/ui";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { NUDGES_VALUES, nudgeMagnitude } from "../types/nudge";
import { useSidebarInputFocus } from "./SidebarInputFocus";

export interface EditableSidebarInputHandle {
  setValue: (value: number) => void;
}

export interface EditableSidebarInputProps {
  ariaLabel: string;
  label?: string | ReactNode;
  labelPosition?: "left" | "right";
  className?: string;
  value?: number | null;
  icon?: ReactNode;
  iconPosition?: "left" | "right";
  onValueChange?: (value: number) => void;
  disabled?: boolean;
  suffix?: string;
  defaultValue?: number;
}

const parseNumericValue = (input: string): number | null => {
  const cleaned = input.replace(/[^0-9.-]/g, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

export const EditableSidebarInput = forwardRef<
  EditableSidebarInputHandle,
  EditableSidebarInputProps
>(
  (
    {
      ariaLabel,
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
    const initialValue = value === undefined ? defaultValue : value;
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState("");
    const [displayValue, setDisplayValue] = useState<number | null>(initialValue);
    const inputRef = useRef<HTMLInputElement>(null);
    const focus = useSidebarInputFocus();

    useImperativeHandle(ref, () => ({ setValue: setDisplayValue }), []);

    useEffect(() => {
      if (!isEditing && value !== undefined) setDisplayValue(value);
    }, [value, isEditing]);

    const handleFocus = useCallback(() => {
      if (disabled) return;
      setIsEditing(true);
      setEditValue(displayValue === null ? "" : String(displayValue));
      focus?.onEditStart();
    }, [disabled, displayValue, focus]);

    const handleBlur = useCallback(() => {
      setIsEditing(false);
      focus?.onEditEnd();
      const numericValue = parseNumericValue(editValue) ?? defaultValue;
      setDisplayValue(numericValue);
      if (onValueChange) onValueChange(numericValue);
    }, [editValue, defaultValue, onValueChange, focus]);

    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (!inputRef.current) return;
        event.nativeEvent.stopImmediatePropagation();

        if (event.key === "Enter") {
          inputRef.current.blur();
          return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key === "a") inputRef.current.select();
        if (event.key === "Escape") {
          setEditValue(displayValue === null ? "" : String(displayValue));
          setIsEditing(false);
          inputRef.current.blur();
          return;
        }
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;

        event.preventDefault();
        const magnitude = nudgeMagnitude({ accel: event.metaKey, shift: event.shiftKey });
        const currentValue = isEditing ? parseNumericValue(editValue) : displayValue;
        if (currentValue === null) return;

        const nextValue =
          currentValue + NUDGES_VALUES[magnitude] * (event.key === "ArrowUp" ? 1 : -1);
        if (isEditing) setEditValue(String(nextValue));
        if (onValueChange) onValueChange(nextValue);
      },
      [displayValue, editValue, isEditing, onValueChange],
    );

    const displayText = displayValue === null ? "" : `${displayValue}${suffix}`;

    return (
      <Tooltip>
        <TooltipTrigger>
          <Input
            ref={inputRef}
            aria-label={ariaLabel}
            label={label}
            labelPosition={labelPosition}
            value={isEditing ? editValue : displayText}
            icon={icon}
            iconPosition={iconPosition}
            readOnly={!isEditing}
            className={cn("w-full", className)}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            onChange={(event) => setEditValue(event.target.value)}
            disabled={disabled}
          />
        </TooltipTrigger>
        <TooltipContent>{ariaLabel}</TooltipContent>
      </Tooltip>
    );
  },
);

EditableSidebarInput.displayName = "EditableSidebarInput";
