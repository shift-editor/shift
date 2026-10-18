import { useEffect, type ReactNode } from "react";
import { Tabs, TabsList, TabsTab } from "@shift/ui";
import { useTheme } from "@/context/ThemeContext";
import type { ThemeAppearance, ThemeMode } from "@/lib/themes";
import { ConfigFileSection } from "./ConfigFileSection";
import { ThemePicker } from "./ThemePicker";

const MODES: readonly { mode: ThemeMode; label: string }[] = [
  { mode: "light", label: "Light" },
  { mode: "dark", label: "Dark" },
  { mode: "system", label: "System" },
];

const SLOTS: Record<ThemeAppearance, { label: string; description: string }> = {
  light: { label: "Light theme", description: "Used in light mode" },
  dark: { label: "Dark theme", description: "Used in dark mode" },
};

/**
 * Settings → Appearance: a mode (Light, Dark or System) and the theme each
 * appearance uses.
 *
 * @remarks
 * Highlighting a theme in a picker previews it on the whole window, even for the
 * appearance not in use; closing the picker without choosing restores it.
 */
export const AppearanceSettingsPanel = () => {
  const { preference, themes, previewTheme, setPreference } = useTheme();
  const { mode } = preference;
  const slots: readonly ThemeAppearance[] = mode === "system" ? ["light", "dark"] : [mode];

  useEffect(() => () => previewTheme(null), [previewTheme]);

  const chooseMode = (next: ThemeMode) => {
    previewTheme(null);
    setPreference({ ...preference, mode: next });
  };

  const chooseTheme = (appearance: ThemeAppearance, id: string) => {
    previewTheme(null);
    setPreference({ ...preference, [appearance]: id });
  };

  return (
    <section className="flex flex-col py-6" aria-label="Appearance">
      <h2 className="px-6 pb-3 text-sm font-medium text-primary">Appearance</h2>

      <SettingRow label="Mode" description="Follow the system, or always use one">
        <Tabs value={mode} onValueChange={(next) => chooseMode(next as ThemeMode)}>
          <TabsList variant="segmented" aria-label="Mode">
            {MODES.map(({ mode: value, label }) => (
              <TabsTab key={value} value={value} variant="segmented">
                {label}
              </TabsTab>
            ))}
          </TabsList>
        </Tabs>
      </SettingRow>

      {slots.map((appearance) => (
        <SettingRow
          key={appearance}
          label={SLOTS[appearance].label}
          description={SLOTS[appearance].description}
        >
          <ThemePicker
            label={SLOTS[appearance].label}
            themes={themes.filter((theme) => theme.appearance === appearance)}
            value={preference[appearance]}
            onPreview={previewTheme}
            onChoose={(id) => chooseTheme(appearance, id)}
          />
        </SettingRow>
      ))}

      <div className="border-t border-chrome px-6 pt-4">
        <ConfigFileSection />
      </div>
    </section>
  );
};

interface SettingRowProps {
  label: string;
  description: string;
  children: ReactNode;
}

const SettingRow = ({ label, description, children }: SettingRowProps) => (
  <div className="flex items-center justify-between gap-6 border-t border-chrome px-6 py-4 first-of-type:border-t-0">
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-sm text-primary">{label}</span>
      <span className="text-ui text-secondary">{description}</span>
    </div>
    {children}
  </div>
);
