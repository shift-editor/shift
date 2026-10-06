import { useEffect, useState } from "react";
import {
  Button,
  Input,
  Select,
  SelectIcon,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectList,
  SelectPopup,
  SelectPortal,
  SelectPositioner,
  SelectTrigger,
  SelectValue,
} from "@shift/ui";
import { useTheme } from "@/context/ThemeContext";
import type { Base16Key, ColorTheme, ThemeAppearance } from "@/lib/themes";
import { paletteRoleGroups, type PaletteRole } from "@/lib/themes/paletteRoles";

interface ThemeEditorProps {
  /** Theme being edited; its id decides which file a save writes. */
  initialTheme: ColorTheme;
  /** True when the theme has not been saved before. */
  isNew: boolean;
  onSave: (theme: ColorTheme) => Promise<void>;
  onCancel: () => void;
}

const HEX_COLOR = /^#?[0-9a-f]{6}$/i;

/**
 * Edits a user theme's name, appearance, and 16 palette colors.
 *
 * @remarks
 * Every change paints the whole app as a preview. The preview ends when the
 * editor unmounts, so cancelling restores the saved preferences.
 */
export const ThemeEditor = ({ initialTheme, isNew, onSave, onCancel }: ThemeEditorProps) => {
  const { setPreviewTheme } = useTheme();
  const [draft, setDraft] = useState(initialTheme);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const trimmedName = draft.name.trim();

  useEffect(() => {
    setPreviewTheme(draft);
  }, [draft, setPreviewTheme]);

  useEffect(() => () => setPreviewTheme(null), [setPreviewTheme]);

  const setColor = (key: Base16Key, color: string) => {
    setDraft((current) => ({ ...current, palette: { ...current.palette, [key]: color } }));
  };

  const save = async () => {
    if (!trimmedName) return;

    setSaving(true);
    setSaveFailed(false);
    try {
      await onSave({ ...draft, name: trimmedName });
    } catch (error) {
      console.error("saving color theme failed", error);
      setSaveFailed(true);
      setSaving(false);
    }
  };

  return (
    <section className="flex flex-col gap-5 p-6">
      <header className="flex flex-col gap-1 pr-8">
        <h2 className="text-sm font-medium text-primary">{isNew ? "New Theme" : "Edit Theme"}</h2>
        <p className="text-ui text-secondary">
          Changes preview across the app. Shift derives every interface and canvas color from these
          16 Base16 colors.
        </p>
      </header>

      <div className="grid grid-cols-3 gap-3">
        <label className="col-span-2 flex min-w-0 flex-col gap-1 text-xs text-secondary">
          Name
          <Input
            size="md"
            variant="plain"
            value={draft.name}
            aria-invalid={!trimmedName}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs text-secondary">
          Appearance
          <Select
            value={draft.appearance}
            onValueChange={(appearance) =>
              setDraft({ ...draft, appearance: appearance as ThemeAppearance })
            }
          >
            <SelectTrigger variant="plain" className="h-8">
              <SelectValue />
              <SelectIcon />
            </SelectTrigger>
            <SelectPortal>
              <SelectPositioner sideOffset={4}>
                <SelectPopup>
                  <SelectList>
                    <SelectItem value="light">
                      <SelectItemIndicator />
                      <SelectItemText>Light</SelectItemText>
                    </SelectItem>
                    <SelectItem value="dark">
                      <SelectItemIndicator />
                      <SelectItemText>Dark</SelectItemText>
                    </SelectItem>
                  </SelectList>
                </SelectPopup>
              </SelectPositioner>
            </SelectPortal>
          </Select>
        </label>
      </div>

      {paletteRoleGroups.map((group) => (
        <fieldset key={group.label} className="flex flex-col gap-1">
          <legend className="mb-2 text-ui font-medium text-primary">{group.label}</legend>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {group.roles.map((role) => (
              <PaletteColorRow
                key={role.key}
                role={role}
                color={draft.palette[role.key]}
                onChange={(color) => setColor(role.key, color)}
              />
            ))}
          </div>
        </fieldset>
      ))}

      <footer className="flex items-center justify-end gap-2">
        {saveFailed && (
          <p role="alert" className="mr-auto text-ui text-error">
            This theme couldn’t be saved. Try again.
          </p>
        )}
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!trimmedName || saving}
          onClick={() => void save()}
        >
          Save Theme
        </Button>
      </footer>
    </section>
  );
};

interface PaletteColorRowProps {
  role: PaletteRole;
  color: string;
  onChange: (color: string) => void;
}

/** One palette slot: a native color well plus a hex field that commits valid colors. */
const PaletteColorRow = ({ role, color, onChange }: PaletteColorRowProps) => {
  const [text, setText] = useState(color);

  useEffect(() => setText(color), [color]);

  const commit = (value: string) => {
    if (!HEX_COLOR.test(value.trim())) {
      setText(color);
      return;
    }

    onChange(`#${value.trim().replace(/^#/, "").toLowerCase()}`);
  };

  return (
    <div className="flex min-w-0 items-center gap-2 py-0.5">
      <input
        type="color"
        value={color}
        aria-label={`${role.label} color`}
        onChange={(event) => onChange(event.target.value)}
        className="size-7 shrink-0 cursor-pointer rounded border border-line-subtle bg-transparent p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-primary">{role.label}</span>
        <span className="truncate text-xs text-muted">{role.description}</span>
      </span>
      <Input
        value={text}
        aria-label={`${role.label} hex value`}
        spellCheck={false}
        className="w-18 shrink-0 font-mono"
        onChange={(event) => setText(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit(event.currentTarget.value);
        }}
      />
    </div>
  );
};
