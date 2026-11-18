import { useRef, useState, type FormEvent } from "react";
import type { Axis } from "@shift/editor/model";
import type { AxisId } from "@shift/types";
import {
  Button,
  Field,
  FieldControl,
  FieldLabel,
  Popover,
  PopoverClose,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTitle,
  Tooltip,
  X,
} from "@shift/ui";
import WarningIcon from "@/assets/general/warning.svg";
import type { useSidebarPanelAnchor } from "@/hooks/useSidebarPanelAnchor";
import { useGlyphDesignspace } from "@/hooks/useGlyphDesignspace";
import type { GlyphAxisDraft } from "@/types/glyphAxes";

/** What the glyph axis popover is open for. */
export type GlyphAxisPopoverTarget =
  | { readonly kind: "add" }
  | { readonly kind: "edit"; readonly axisId: AxisId; readonly focus: "name" | "range" }
  /** An edit the engine refused, and why. */
  | { readonly kind: "refused"; readonly message: string };

const NEW_AXIS: GlyphAxisDraft = { name: "", minimum: 0, default: 0, maximum: 100 };
const ERROR_ID = "glyph-axis-error";

/** The engine's reason for refusing an edit, as the popover shows it. */
export function refusalMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The fields' text for `axis`, or for a new axis. */
function draftFor(axis: Axis | null): Record<keyof GlyphAxisDraft, string> {
  const draft = axis
    ? { name: axis.name, minimum: axis.minimum, default: axis.kind.default, maximum: axis.maximum }
    : NEW_AXIS;
  return {
    name: draft.name,
    minimum: String(draft.minimum),
    default: String(draft.default),
    maximum: String(draft.maximum),
  };
}

/** The draft the fields describe, or why they don't describe one. */
function parseDraft(text: Record<keyof GlyphAxisDraft, string>): GlyphAxisDraft | string {
  const name = text.name.trim();
  if (name.length === 0) return "Give the axis a name";

  const [minimum, value, maximum] = [text.minimum, text.default, text.maximum].map(Number);
  if (![minimum, value, maximum].every((number) => Number.isFinite(number))) {
    return "Minimum, default and maximum must be numbers";
  }
  if (!(minimum! <= value! && value! <= maximum! && minimum! < maximum!)) {
    return "The default must lie between the minimum and the maximum";
  }
  return { name, minimum: minimum!, default: value!, maximum: maximum! };
}

interface GlyphAxisPopoverProps {
  target: GlyphAxisPopoverTarget | null;
  axes: readonly Axis[];
  positioner: ReturnType<typeof useSidebarPanelAnchor>["positioner"];
  onClose: () => void;
}

/**
 * Adds or edits one of the edited glyph's axes beside the sidebar: its name
 * (the tag is made from it) and its range, in the axis's own units. A range
 * that would leave a stored value outside it is refused with the engine's
 * reason, as is removing an axis still in use.
 */
export const GlyphAxisPopover = ({ target, axes, positioner, onClose }: GlyphAxisPopoverProps) => {
  return (
    <Popover open={target !== null} onOpenChange={(next) => !next && onClose()} modal={false}>
      <PopoverPortal>
        <PopoverPositioner {...positioner}>
          {target ? <OpenGlyphAxisForm target={target} axes={axes} onClose={onClose} /> : null}
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  );
};

/** The form for `target`, keyed so each opening starts from its axis's values. */
const OpenGlyphAxisForm = ({
  target,
  axes,
  onClose,
}: {
  target: GlyphAxisPopoverTarget;
  axes: readonly Axis[];
  onClose: () => void;
}) => {
  if (target.kind !== "edit") {
    return <GlyphAxisForm key={target.kind} target={target} axis={null} onClose={onClose} />;
  }

  const axis = axes.find((candidate) => candidate.id === target.axisId) ?? null;
  return <GlyphAxisForm key={target.axisId} target={target} axis={axis} onClose={onClose} />;
};

function title(target: GlyphAxisPopoverTarget): string {
  switch (target.kind) {
    case "add":
      return "Add Glyph Axis";
    case "edit":
      return "Edit Glyph Axis";
    case "refused":
      return "Cannot Remove Axis";
  }
}

const GlyphAxisForm = ({
  target,
  axis,
  onClose,
}: {
  target: GlyphAxisPopoverTarget;
  axis: Axis | null;
  onClose: () => void;
}) => {
  const glyphs = useGlyphDesignspace();
  const [text, setText] = useState(() => draftFor(axis));
  const [issue, setIssue] = useState<string | null>(
    target.kind === "refused" ? target.message : null,
  );
  const nameRef = useRef<HTMLInputElement>(null);
  const minimumRef = useRef<HTMLInputElement>(null);
  const focus = target.kind === "edit" && target.focus === "range" ? minimumRef : nameRef;

  const field = (name: keyof GlyphAxisDraft) => ({
    value: text[name],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      setIssue(null);
      setText({ ...text, [name]: event.target.value });
    },
  });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const draft = parseDraft(text);
    if (typeof draft === "string") {
      setIssue(draft);
      return;
    }

    try {
      if (target.kind === "edit") await glyphs.updateAxis(target.axisId, draft);
      else await glyphs.addAxis(draft);
      onClose();
    } catch (error) {
      setIssue(refusalMessage(error));
    }
  };

  return (
    <PopoverPopup className="w-56 p-0" initialFocus={target.kind === "refused" ? undefined : focus}>
      <div className="flex h-8 items-center justify-between border-b border-line-subtle px-2">
        <PopoverTitle>{title(target)}</PopoverTitle>
        <Tooltip content="Close">
          <PopoverClose variant="icon" aria-label="Close">
            <X className="h-4 w-4" />
          </PopoverClose>
        </Tooltip>
      </div>

      {target.kind === "refused" ? (
        <Issue message={target.message} />
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          <div className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-x-2 px-2 py-1">
            <AxisField id="glyph-axis-name" label="Name" inputRef={nameRef} {...field("name")} />
            <AxisField
              id="glyph-axis-minimum"
              label="Minimum"
              inputRef={minimumRef}
              numeric
              {...field("minimum")}
            />
            <AxisField id="glyph-axis-default" label="Default" numeric {...field("default")} />
            <AxisField id="glyph-axis-maximum" label="Maximum" numeric {...field("maximum")} />
          </div>
          {issue && <Issue message={issue} />}
          <div className="grid grid-cols-2 gap-2 px-2 pb-2 pt-1.5">
            <PopoverClose
              render={
                <Button type="button" className="h-7.5 text-ui">
                  Cancel
                </Button>
              }
            />
            <Button type="submit" variant="primary" className="h-7.5 text-ui">
              {target.kind === "add" ? "Add" : "Save"}
            </Button>
          </div>
        </form>
      )}
    </PopoverPopup>
  );
};

const AxisField = ({
  id,
  label,
  value,
  numeric = false,
  inputRef,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  numeric?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}) => (
  <Field className="contents">
    <FieldLabel htmlFor={id} tone="primary" className="text-ui">
      {label}
    </FieldLabel>
    <FieldControl
      ref={inputRef}
      id={id}
      value={value}
      onChange={onChange}
      variant="plain"
      className="min-w-0 max-w-full text-right text-ui"
      inputMode={numeric ? "decimal" : undefined}
    />
  </Field>
);

const Issue = ({ message }: { message: string }) => (
  <div
    id={ERROR_ID}
    role="alert"
    className="flex items-start gap-1.5 px-2 py-1.5 text-ui text-error"
  >
    <WarningIcon className="mt-0.5 h-3 w-3 shrink-0 text-error" aria-hidden="true" />
    <span>{message}</span>
  </div>
);
