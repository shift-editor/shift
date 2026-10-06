import { useState } from "react";
import {
  Button,
  RadioCard,
  RadioGroup,
  Select,
  SelectGroup,
  SelectGroupLabel,
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
import { isUserThemeId } from "@shared/themes";
import { useTheme } from "@/context/ThemeContext";
import { getShiftHost } from "@/host/shiftHost";
import {
  colorThemes,
  type ColorTheme,
  type ThemeAppearance,
  type ThemeSelection,
} from "@/lib/themes";
import { duplicateTheme, newUserThemeId } from "@/lib/themes/paletteRoles";
import { ThemeEditor } from "./ThemeEditor";

/** A theme open in the editor, and whether saving it creates a new file. */
interface ThemeEdit {
  theme: ColorTheme;
  isNew: boolean;
}

export const AppearanceSettingsPanel = () => {
  const { preferences, themes, userThemes, resolvedTheme, setThemeSelection } = useTheme();
  const [edit, setEdit] = useState<ThemeEdit | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (edit) {
    const save = async (edited: ColorTheme) => {
      const theme = edit.isNew
        ? { ...edited, id: newUserThemeId(edited.name, userThemes) }
        : edited;
      await getShiftHost().themes.save(theme);
      setThemeSelection(theme.id);
      setEdit(null);
    };

    return (
      <ThemeEditor
        key={edit.theme.id}
        initialTheme={edit.theme}
        isNew={edit.isNew}
        onSave={save}
        onCancel={() => setEdit(null)}
      />
    );
  }

  const options: readonly { selection: ThemeSelection; label: string; theme: ColorTheme }[] = [
    { selection: "system", label: "System", theme: resolvedTheme },
    ...themes.map((theme) => ({ selection: theme.id, label: theme.name, theme })),
  ];
  const editable = isUserThemeId(resolvedTheme.id);

  const run = async (label: string, action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (error) {
      console.error(`${label} failed`, error);
    }
  };

  const importTheme = () =>
    run("importing color theme", async () => {
      const result = await getShiftHost().themes.import();
      if (result.status === "imported") setThemeSelection(result.theme.id);
    });

  const deleteTheme = () =>
    run("deleting color theme", async () => {
      await getShiftHost().themes.remove(resolvedTheme.id);
      if (preferences.selection === resolvedTheme.id) setThemeSelection("system");
      setConfirmingDelete(false);
    });

  return (
    <section className="flex flex-col gap-5 p-6">
      <header className="flex flex-col gap-1 pr-8">
        <h2 className="text-sm font-medium text-primary">Appearance</h2>
        <p className="text-ui text-secondary">
          Choose a color theme for the application and editor canvas, or create your own.
        </p>
      </header>

      <fieldset className="flex flex-col gap-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <legend className="text-ui font-medium text-primary">Color theme</legend>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => void importTheme()}>
              Import…
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setEdit({ theme: duplicateTheme(resolvedTheme, userThemes), isNew: true })
              }
            >
              New Theme
            </Button>
          </div>
        </div>
        <RadioGroup
          aria-label="Color theme"
          value={preferences.selection}
          onValueChange={(value) => {
            setConfirmingDelete(false);
            setThemeSelection(value as ThemeSelection);
          }}
          className="grid grid-cols-2"
        >
          {options.map(({ selection, label, theme }) => (
            <RadioCard key={selection} value={selection}>
              <span className="flex min-w-0 flex-col items-start">
                <span className="truncate">{label}</span>
                <span className="text-ui text-muted">{themeKind(selection, theme)}</span>
              </span>
              <ThemeSwatches theme={theme} />
            </RadioCard>
          ))}
        </RadioGroup>

        <div
          role="group"
          aria-label={`${resolvedTheme.name} actions`}
          className="flex min-h-7 items-center gap-1"
        >
          {confirmingDelete ? (
            <>
              <span className="mr-auto truncate text-ui text-primary">
                Delete “{resolvedTheme.name}”? Its file is removed.
              </span>
              <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void deleteTheme()}>
                Delete
              </Button>
            </>
          ) : (
            <>
              <span className="mr-auto truncate text-ui text-secondary">{resolvedTheme.name}</span>
              {editable && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEdit({ theme: resolvedTheme, isNew: false })}
                >
                  Edit
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setEdit({ theme: duplicateTheme(resolvedTheme, userThemes), isNew: true })
                }
              >
                Duplicate
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void run("exporting color theme", () =>
                    getShiftHost().themes.export(resolvedTheme),
                  )
                }
              >
                Export…
              </Button>
              {editable && (
                <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(true)}>
                  Delete
                </Button>
              )}
            </>
          )}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-ui font-medium text-primary">System appearance</legend>
        <p className="mb-1 text-ui text-secondary">
          When System is selected, Shift follows your operating system between these themes.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <SystemThemeSelect appearance="light" label="Light" />
          <SystemThemeSelect appearance="dark" label="Dark" />
        </div>
      </fieldset>

      <div>
        <Button
          size="sm"
          variant="muted"
          onClick={() =>
            void run("opening themes folder", () => getShiftHost().themes.revealFolder())
          }
        >
          Show Themes Folder
        </Button>
      </div>
    </section>
  );
};

function themeKind(selection: ThemeSelection, theme: ColorTheme): string {
  const appearance = theme.appearance === "dark" ? "Dark" : "Light";
  if (selection === "system") return "Follows OS";
  return isUserThemeId(theme.id) ? `Custom · ${appearance}` : appearance;
}

interface SystemThemeSelectProps {
  appearance: ThemeAppearance;
  label: string;
}

/** Picks the theme `system` uses for one OS appearance, offering themes of that appearance. */
const SystemThemeSelect = ({ appearance, label }: SystemThemeSelectProps) => {
  const { preferences, themes, setSystemTheme } = useTheme();
  const matching = themes.filter((theme) => theme.appearance === appearance);
  const builtIn = matching.filter((theme) => !isUserThemeId(theme.id));
  const custom = matching.filter((theme) => isUserThemeId(theme.id));
  const selectedId = matching.some((theme) => theme.id === preferences[appearance])
    ? preferences[appearance]
    : (colorThemes.find((theme) => theme.appearance === appearance)?.id ?? null);
  const items = Object.fromEntries(matching.map((theme) => [theme.id, theme.name]));

  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs text-secondary">
      {label}
      <Select
        value={selectedId}
        items={items}
        onValueChange={(id) => {
          if (id) setSystemTheme(appearance, id);
        }}
      >
        <SelectTrigger variant="plain" className="h-8">
          <SelectValue />
          <SelectIcon />
        </SelectTrigger>
        <SelectPortal>
          <SelectPositioner sideOffset={4}>
            <SelectPopup>
              <SelectList>
                <ThemeSelectItems themes={builtIn} />
                {custom.length > 0 && (
                  <SelectGroup>
                    <SelectGroupLabel>Custom</SelectGroupLabel>
                    <ThemeSelectItems themes={custom} />
                  </SelectGroup>
                )}
              </SelectList>
            </SelectPopup>
          </SelectPositioner>
        </SelectPortal>
      </Select>
    </label>
  );
};

const ThemeSelectItems = ({ themes }: { themes: readonly ColorTheme[] }) =>
  themes.map((theme) => (
    <SelectItem key={theme.id} value={theme.id}>
      <SelectItemIndicator />
      <SelectItemText>{theme.name}</SelectItemText>
    </SelectItem>
  ));

const ThemeSwatches = ({ theme }: { theme: ColorTheme }) => {
  const { palette } = theme;
  const colors = [
    palette.base00,
    palette.base05,
    palette.base08,
    palette.base0B,
    palette.base0D,
    palette.base0E,
  ];

  return (
    <span
      aria-hidden
      className="flex shrink-0 overflow-hidden rounded-sm border border-line-subtle"
    >
      {colors.map((color, index) => (
        <span key={`${color}-${index}`} className="h-4 w-3" style={{ backgroundColor: color }} />
      ))}
    </span>
  );
};
