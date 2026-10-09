import { useRef, useState, type ReactNode } from "react";
import { NumberField, NumberFieldGroup, NumberFieldInput, Tooltip } from "@shift/ui";
import { NUDGES_VALUES } from "@shift/editor/types";
import { useFocusZone } from "@/context/FocusZoneContext";

interface SidebarNumberFieldProps {
  /** Names the field for assistive technology and its tooltip. */
  ariaLabel: string;
  /** The value shown while the field is not being typed in. */
  value: number;
  /** Called with each committed value: on Enter, on blur, and on every arrow step. */
  onValueCommit: (value: number) => void;
  /** A short leading label such as "W", or an icon. */
  label?: ReactNode;
  /** Formats the value with a unit, such as degrees. */
  unit?: "degree";
  /** Text after the number, such as "x" for a factor. */
  suffix?: string;
  disabled?: boolean;
}

/**
 * A numeric sidebar field over the shared `NumberField`.
 *
 * @remarks
 * Arrow keys step by 1 and Shift by 10, as Base UI does; Cmd steps by 100,
 * matching canvas nudges. Enter commits and leaves the field, Escape leaves it
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
  disabled = false,
}: SidebarNumberFieldProps) {
  const { lockToZone, unlock } = useFocusZone();
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
          ...(unit && { style: "unit", unit, unitDisplay: "narrow" }),
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
            onFocus={(event) => {
              cancelled.current = false;
              lockToZone("sidebar");
              event.currentTarget.select();
            }}
            onBlur={(event) => {
              unlock();
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
                  if (!event.metaKey) return;
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
