import { useRef, useState, type ReactNode } from "react";
import { NumberField, NumberFieldGroup, NumberFieldInput, Tooltip } from "@shift/ui";
import { NUDGES_VALUES } from "@shift/editor/types";

interface SidebarNumberFieldProps {
  /** Names the field for assistive technology and its tooltip. */
  ariaLabel: string;
  /** The value shown while the field is not being typed in; `null` shows `placeholder`. */
  value: number | null;
  /** Called with each committed value: on Enter, on blur, and on every arrow step. */
  onValueCommit: (value: number) => void;
  /** A short leading label such as "W", or an icon. */
  label?: ReactNode;
  /** Formats the value with a unit, such as degrees. */
  unit?: "degree";
  /** Text after the number, such as "x" for a factor. */
  suffix?: string;
  /** Shown greyed while `value` is `null`, such as what an unset value falls back to. */
  placeholder?: string;
  /** Classes for the input, such as `text-right` for a column of numbers. */
  inputClassName?: string;
  disabled?: boolean;
}

/**
 * A numeric sidebar field over the shared `NumberField`.
 *
 * @remarks
 * Arrow keys step by 1 and Shift by 10, as Base UI does; Cmd or Ctrl steps by 100,
 * matching canvas nudges. Arrow keys do nothing while the value is `null`,
 * since there is no number to step from. Enter commits and leaves the field, Escape leaves it
 * without committing what was typed. While focused, the sidebar keeps keyboard
 * focus and editor shortcuts do not fire.
 */
export function SidebarNumberField({
  ariaLabel,
  value,
  onValueCommit,
  label,
  unit,
  suffix,
  placeholder,
  inputClassName,
  disabled = false,
}: SidebarNumberFieldProps) {
  const cancelled = useRef(false);
  // Remounting shows `value` again; after a commit or Escape, typed text must not linger.
  const [revision, setRevision] = useState(0);

  return (
    <Tooltip content={ariaLabel}>
      <NumberField
        key={revision}
        className="w-full"
        value={value}
        step={NUDGES_VALUES.small}
        smallStep={NUDGES_VALUES.small}
        largeStep={NUDGES_VALUES.medium}
        format={{
          maximumFractionDigits: 2,
          useGrouping: false,
          style: unit === undefined ? "decimal" : "unit",
          unit,
          unitDisplay: "narrow",
        }}
        disabled={disabled}
        onValueCommitted={(next, details) => {
          if (cancelled.current || next === null) return;
          onValueCommit(next);
          if (details.reason !== "keyboard") setRevision((current) => current + 1);
        }}
      >
        <NumberFieldGroup className="h-6">
          {label && <span className="shrink-0 pl-2 text-ui font-medium text-muted">{label}</span>}
          <NumberFieldInput
            aria-label={ariaLabel}
            size="compact"
            placeholder={placeholder}
            className={inputClassName}
            onFocus={(event) => {
              cancelled.current = false;
              event.currentTarget.select();
            }}
            onBlur={(event) => {
              if (!cancelled.current) return;
              // Skip Base UI's commit on blur and show the value again.
              event.preventDefault();
              setRevision((current) => current + 1);
            }}
            onKeyDown={(event) => {
              event.nativeEvent.stopImmediatePropagation();
              switch (event.key) {
                case "Enter":
                  event.currentTarget.blur();
                  return;
                case "Escape":
                  cancelled.current = true;
                  event.currentTarget.blur();
                  return;
                case "ArrowUp":
                case "ArrowDown":
                  if (value === null) {
                    event.preventDefault();
                    return;
                  }
                  // The accelerator is Cmd on macOS and Ctrl elsewhere, as for canvas nudges.
                  if (!event.metaKey && !event.ctrlKey) return;
                  event.preventDefault();
                  onValueCommit(value + (event.key === "ArrowUp" ? 1 : -1) * NUDGES_VALUES.large);
              }
            }}
          />
          {suffix && <span className="shrink-0 pr-2 text-ui text-muted">{suffix}</span>}
        </NumberFieldGroup>
      </NumberField>
    </Tooltip>
  );
}
