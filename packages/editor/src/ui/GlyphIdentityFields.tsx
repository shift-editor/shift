import { Input } from "@shift/ui";
import { useEffect, useRef, useState } from "react";
import type { Font } from "../lib/model/Font";
import type { Glyph } from "../lib/model/Glyph";
import { useSignalState } from "../lib/signals";
import { codepointToHex, formatCodepointAsUPlus } from "../lib/utils/unicode";
import type { GlyphIdentityConflict, GlyphIdentityEdit } from "../types/glyph";

export interface GlyphIdentityFieldsProps {
  font: Font;
  /** The glyph to show; null shows empty, disabled fields. */
  glyph: Glyph | null;
  /** Whether the fields can rename the glyph or change its codepoint. */
  editable: boolean;
}

/**
 * The glyph's name and primary codepoint, side by side, each edited in place.
 *
 * @remarks
 * Changes go through {@link Font.renameGlyph} and
 * {@link Font.setPrimaryCodepoint}, which own the rules and are undoable. A
 * refused change reverts the field and says why below it; clearing the
 * codepoint removes it.
 */
export function GlyphIdentityFields({ font, glyph, editable }: GlyphIdentityFieldsProps) {
  if (!glyph) {
    return (
      <div className="flex gap-1.5">
        <Input aria-label="Glyph name" value="" disabled readOnly className="text-center" />
        <div className="w-18 shrink-0">
          <Input aria-label="Unicode" label="U+" value="" disabled readOnly />
        </div>
      </div>
    );
  }

  return <GlyphIdentityFieldsFor font={font} glyph={glyph} editable={editable} />;
}

function GlyphIdentityFieldsFor({
  font,
  glyph,
  editable,
}: GlyphIdentityFieldsProps & { glyph: Glyph }) {
  const entry = useSignalState(glyph.entryCell);
  const unicode = entry.unicodes[0] ?? null;
  const [conflict, setConflict] = useState<GlyphIdentityConflict | null>(null);
  const report = (change: GlyphIdentityEdit) =>
    setConflict(change.kind === "refused" ? change.conflict : null);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1.5">
        <TextField
          ariaLabel="Glyph name"
          value={entry.name}
          disabled={!editable}
          className="text-center"
          onCommit={(text) => report(font.renameGlyph(entry.id, text))}
        />
        <div className="w-18 shrink-0">
          <TextField
            ariaLabel="Unicode"
            label="U+"
            value={unicode === null ? "" : codepointToHex(unicode)}
            disabled={!editable}
            onCommit={(text) => report(font.setPrimaryCodepoint(entry.id, text))}
          />
        </div>
      </div>
      {conflict ? (
        <p role="alert" className="text-xs text-muted">
          {conflictMessage(conflict)}
        </p>
      ) : null}
    </div>
  );
}

/** Says why a name or codepoint was not changed. */
function conflictMessage(conflict: GlyphIdentityConflict): string {
  switch (conflict.kind) {
    case "blankName":
      return "A glyph needs a name.";
    case "invalidName":
      return `${conflict.name} is not a valid glyph name.`;
    case "nameTaken":
      return `Another glyph is named ${conflict.name}.`;
    case "invalidCodepoint":
      return `${conflict.text.trim()} is not a Unicode codepoint.`;
    case "codepointTaken":
      return `${formatCodepointAsUPlus(conflict.codepoint)} belongs to ${conflict.owner}.`;
  }
}

interface TextFieldProps {
  ariaLabel: string;
  label?: string;
  value: string;
  disabled: boolean;
  className?: string;
  /** Called with the typed text on Enter or blur; the field then shows the glyph's value again. */
  onCommit: (text: string) => void;
}

/** A sidebar text field: Enter or blur commits, Escape restores the current value. */
function TextField({ ariaLabel, label, value, disabled, className, onCommit }: TextFieldProps) {
  const [draft, setDraft] = useState(value);
  // A ref, not state: Escape blurs synchronously, before a state update would land.
  const cancelled = useRef(false);

  // A refused edit, an undo, or another glyph replaces the draft.
  useEffect(() => setDraft(value), [value]);

  return (
    <Input
      aria-label={ariaLabel}
      label={label}
      value={draft}
      disabled={disabled}
      className={className}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onFocus={(event) => {
        cancelled.current = false;
        event.currentTarget.select();
      }}
      onBlur={() => {
        if (!cancelled.current && draft !== value) onCommit(draft);
        setDraft(value);
      }}
      onKeyDown={(event) => {
        event.nativeEvent.stopImmediatePropagation();
        if (event.key === "Escape") cancelled.current = true;
        if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
      }}
    />
  );
}
