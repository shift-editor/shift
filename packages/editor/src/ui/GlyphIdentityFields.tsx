import { Input } from "@shift/ui";
import type { GlyphName } from "@shift/types";
import { useEffect, useRef, useState } from "react";
import type { Font } from "../lib/model/Font";
import type { Glyph } from "../lib/model/Glyph";
import { useSignalState } from "../lib/signals";
import { codepointToHex, parseCodepoint } from "../lib/utils/unicode";

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
 * Changes go through {@link Font.updateGlyphIdentity}, so they are undoable.
 * A name or codepoint another glyph already uses is refused and the field
 * reverts; clearing the codepoint removes it.
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
  const otherUnicodes = entry.unicodes.slice(1);

  const rename = (text: string) => {
    const name = text.trim() as GlyphName;
    if (!name || name === entry.name || font.recordForName(name)) return;
    font.updateGlyphIdentity(entry.id, name, [...entry.unicodes]);
  };

  const assignUnicode = (text: string) => {
    if (text.trim() === "") {
      if (unicode !== null) font.updateGlyphIdentity(entry.id, entry.name, otherUnicodes);
      return;
    }

    const codepoint = parseCodepoint(text);
    if (codepoint === null || codepoint === unicode) return;
    const owner = font.entryForUnicode(codepoint);
    if (owner && owner.id !== entry.id) return;

    const rest = otherUnicodes.filter((value) => value !== codepoint);
    font.updateGlyphIdentity(entry.id, entry.name, [codepoint, ...rest]);
  };

  return (
    <div className="flex gap-1.5">
      <TextField
        ariaLabel="Glyph name"
        value={entry.name}
        disabled={!editable}
        className="text-center"
        onCommit={rename}
      />
      <div className="w-18 shrink-0">
        <TextField
          ariaLabel="Unicode"
          label="U+"
          value={unicode === null ? "" : codepointToHex(unicode)}
          disabled={!editable}
          onCommit={assignUnicode}
        />
      </div>
    </div>
  );
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
