import { RadioCard, RadioGroup } from "@shift/ui";
import { useTheme } from "@/context/ThemeContext";
import { colorThemes, type ColorTheme, type ThemeSelection } from "@/lib/themes";

export const AppearanceSettingsPanel = () => {
  const { themeSelection, resolvedTheme, setThemeSelection } = useTheme();
  const options: readonly {
    selection: ThemeSelection;
    label: string;
    theme: ColorTheme;
  }[] = [
    { selection: "system", label: "System", theme: resolvedTheme },
    ...colorThemes.map((theme) => ({ selection: theme.id, label: theme.name, theme })),
  ];

  return (
    <section className="flex flex-col gap-5 p-6">
      <header className="flex flex-col gap-1 pr-8">
        <h2 className="text-sm font-medium text-primary">Appearance</h2>
        <p className="text-ui text-secondary">
          Choose a color theme for the application and editor canvas.
        </p>
      </header>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-ui font-medium text-primary">Color theme</legend>
        <RadioGroup
          aria-label="Color theme"
          value={themeSelection}
          onValueChange={(value) => setThemeSelection(value as ThemeSelection)}
          className="grid grid-cols-2"
        >
          {options.map(({ selection, label, theme }) => (
            <RadioCard key={selection} value={selection}>
              <span className="flex min-w-0 flex-col items-start">
                <span className="truncate">{label}</span>
                <span className="text-ui capitalize text-muted">{theme.appearance}</span>
              </span>
              <ThemeSwatches theme={theme} />
            </RadioCard>
          ))}
        </RadioGroup>
      </fieldset>
    </section>
  );
};

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
