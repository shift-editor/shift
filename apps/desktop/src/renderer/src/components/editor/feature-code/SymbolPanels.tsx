import { useState } from "react";
import type { FeatureRange, FeatureSymbol } from "@shift/types";
import { Button } from "@shift/ui";
import { DockedPanel } from "./DockedPanel";

/** Where a reference sits: its line number and the line's text. */
export interface LineOfCode {
  readonly number: number;
  /** Offset of the line's start in the code. */
  readonly from: number;
  readonly text: string;
}

interface ReferencesPanelProps {
  readonly symbol: FeatureSymbol;
  readonly lineAt: (offset: number) => LineOfCode;
  readonly onSelect: (range: FeatureRange) => void;
  readonly onClose: () => void;
}

/** Where a class, lookup, or glyph is defined and used; choosing a row jumps to it. */
export const ReferencesPanel = ({ symbol, lineAt, onSelect, onClose }: ReferencesPanelProps) => {
  const rows = [
    ...symbol.definitions.map((range) => ({ range, definition: true })),
    ...symbol.references.map((range) => ({ range, definition: false })),
  ];
  const count = rows.length === 1 ? "1 place" : `${rows.length} places`;
  return (
    <DockedPanel
      label="References"
      title={
        <>
          <span className="font-mono font-normal">{symbol.name}</span>
          <span className="font-normal text-secondary"> · {count}</span>
        </>
      }
      onClose={onClose}
    >
      <ul>
        {rows.map(({ range, definition }) => {
          const line = lineAt(range.from);
          return (
            <li key={range.from}>
              <button
                type="button"
                className="flex h-6 w-full items-center gap-2.5 px-4 text-left text-ui hover:bg-hover/50"
                onClick={() => onSelect(range)}
              >
                <span className="w-12 shrink-0 text-secondary">Ln {line.number}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-primary">
                  {line.text.trim()}
                </span>
                {definition ? <span className="shrink-0 text-secondary">Definition</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </DockedPanel>
  );
};

interface RenamePanelProps {
  readonly symbol: FeatureSymbol;
  /** Renames the symbol; resolves false when the name isn't valid. */
  readonly onRename: (newName: string) => Promise<boolean>;
  readonly onClose: () => void;
}

/** Renames a class or lookup everywhere it's written. */
export const RenamePanel = ({ symbol, onRename, onClose }: RenamePanelProps) => {
  const [name, setName] = useState(symbol.name);
  const [invalid, setInvalid] = useState(false);
  const occurrences = symbol.definitions.length + symbol.references.length;
  const submit = async () => {
    if (name === symbol.name) return onClose();
    const renamed = await onRename(name);
    if (renamed) onClose();
    else setInvalid(true);
  };
  return (
    <DockedPanel
      label="Rename"
      title={
        <>
          Rename <span className="font-mono font-normal">{symbol.name}</span>
          <span className="font-normal text-secondary">
            {" "}
            · {occurrences === 1 ? "1 place" : `${occurrences} places`}
          </span>
        </>
      }
      onClose={onClose}
    >
      <form
        className="flex items-center gap-2 px-4 pt-0.5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <input
          // The panel opens for typing a name, as an editor's rename box does.
          // oxlint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          aria-label="New name"
          aria-invalid={invalid}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setInvalid(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
          }}
          onFocus={(event) => event.target.select()}
          className="h-6 min-w-0 flex-1 rounded bg-input px-2 font-mono text-xs text-primary outline-none focus-visible:ring-1 focus-visible:ring-accent aria-invalid:ring-1 aria-invalid:ring-error"
        />
        <Button type="submit" variant="ghost" size="sm">
          Rename
        </Button>
      </form>
      {invalid ? (
        <p className="px-4 pt-1 text-ui text-error">
          Names start with a letter or _, then letters, digits, _, . or -
        </p>
      ) : null}
    </DockedPanel>
  );
};
