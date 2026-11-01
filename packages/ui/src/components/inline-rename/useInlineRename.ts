import * as React from "react";

/** The props an input editing a name in place spreads. */
export interface InlineRenameProps {
  readonly autoFocus: true;
  readonly value: string;
  readonly onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  readonly onFocus: (event: React.FocusEvent<HTMLInputElement>) => void;
  readonly onBlur: () => void;
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}

/**
 * Edits a name in place, as renaming a page or a tab does.
 *
 * @remarks
 * The field starts focused with the name selected. Enter or leaving it
 * reports the draft; Escape reports null so nothing is renamed. Keys stop at
 * the field, so the app's shortcuts do not fire while typing.
 *
 * @param name - the name being edited.
 * @param onDone - receives the new name, or null when renaming was cancelled.
 * @returns props for the input.
 */
export function useInlineRename(
  name: string,
  onDone: (name: string | null) => void,
): InlineRenameProps {
  const [draft, setDraft] = React.useState(name);
  const cancelled = React.useRef(false);

  return {
    autoFocus: true,
    value: draft,
    onChange: (event) => setDraft(event.currentTarget.value),
    onFocus: (event) => event.currentTarget.select(),
    onBlur: () => onDone(cancelled.current ? null : draft),
    onKeyDown: (event) => {
      event.nativeEvent.stopImmediatePropagation();
      if (event.key === "Escape") cancelled.current = true;
      if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
    },
  };
}
