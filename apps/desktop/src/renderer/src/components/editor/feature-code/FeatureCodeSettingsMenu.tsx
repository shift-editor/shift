import type { FeatureCodeSettings } from "@shift/types";
import {
  Button,
  Check,
  Menu,
  MenuCheckboxItem,
  MenuCheckboxItemIndicator,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuSeparator,
  MenuSubmenuRoot,
  MenuSubmenuTrigger,
  MenuTrigger,
} from "@shift/ui";

interface FeatureCodeSettingsMenuProps {
  readonly settings: FeatureCodeSettings;
  /** Replaces the font's settings as one undoable edit named `label`. */
  readonly onChange: (label: string, settings: FeatureCodeSettings) => void;
  /** Formats the code now. */
  readonly onFormat: () => void;
}

/** One indent choice: what the menu says and the settings it stores. */
interface IndentChoice {
  readonly label: string;
  readonly indent: FeatureCodeSettings["indent"];
  readonly indentWidth: number;
}

const INDENTS: readonly IndentChoice[] = [
  { label: "Match Existing Code", indent: "auto", indentWidth: 4 },
  { label: "2 Spaces", indent: "spaces", indentWidth: 2 },
  { label: "4 Spaces", indent: "spaces", indentWidth: 4 },
  { label: "Tabs", indent: "tab", indentWidth: 4 },
];

const LINE_WIDTHS = [80, 100, 120];

/**
 * The status bar's Format menu, as editors split it: Format Document runs now,
 * and the settings below say how this font's code is formatted and linted.
 */
export const FeatureCodeSettingsMenu = ({
  settings,
  onChange,
  onFormat,
}: FeatureCodeSettingsMenuProps) => {
  const isIndent = (choice: IndentChoice) =>
    choice.indent === settings.indent &&
    (choice.indent !== "spaces" || choice.indentWidth === settings.indentWidth);

  return (
    <Menu modal={false}>
      <MenuTrigger render={<Button variant="ghost" size="sm" />}>Format</MenuTrigger>
      <MenuPortal>
        <MenuPositioner side="top" sideOffset={6} align="end">
          <MenuPopup>
            <MenuItem onClick={onFormat} className="justify-between gap-6">
              Format Document
              <span className="text-secondary">⇧⌘F</span>
            </MenuItem>
            <MenuSeparator />
            <SettingItem
              checked={settings.formatOnSave}
              onCheckedChange={(formatOnSave) =>
                onChange("Format on Save", { ...settings, formatOnSave })
              }
            >
              Format on Save
            </SettingItem>
            <SettingItem
              checked={settings.keepAlignment}
              onCheckedChange={(keepAlignment) =>
                onChange("Keep Alignment", { ...settings, keepAlignment })
              }
            >
              Keep Hand Alignment
            </SettingItem>
            <MenuSeparator />
            <MenuSubmenuRoot>
              <MenuSubmenuTrigger>Indent</MenuSubmenuTrigger>
              <MenuPortal>
                <MenuPositioner sideOffset={4}>
                  <MenuPopup>
                    {INDENTS.map((choice) => (
                      <SettingItem
                        key={choice.label}
                        checked={isIndent(choice)}
                        onCheckedChange={() =>
                          onChange("Change Indent", {
                            ...settings,
                            indent: choice.indent,
                            indentWidth: choice.indentWidth,
                          })
                        }
                      >
                        {choice.label}
                      </SettingItem>
                    ))}
                  </MenuPopup>
                </MenuPositioner>
              </MenuPortal>
            </MenuSubmenuRoot>
            <MenuSubmenuRoot>
              <MenuSubmenuTrigger>Line Width</MenuSubmenuTrigger>
              <MenuPortal>
                <MenuPositioner sideOffset={4}>
                  <MenuPopup>
                    {LINE_WIDTHS.map((lineWidth) => (
                      <SettingItem
                        key={lineWidth}
                        checked={settings.lineWidth === lineWidth}
                        onCheckedChange={() =>
                          onChange("Change Line Width", {
                            ...settings,
                            lineWidth,
                          })
                        }
                      >
                        {lineWidth} Characters
                      </SettingItem>
                    ))}
                  </MenuPopup>
                </MenuPositioner>
              </MenuPortal>
            </MenuSubmenuRoot>
            <MenuSubmenuRoot>
              <MenuSubmenuTrigger>Ignored Rules</MenuSubmenuTrigger>
              <MenuPortal>
                <MenuPositioner sideOffset={4}>
                  <MenuPopup>
                    {settings.ignoredRules.length === 0 ? <MenuItem disabled>None</MenuItem> : null}
                    {settings.ignoredRules.map((rule) => (
                      <SettingItem
                        key={rule}
                        checked
                        onCheckedChange={() =>
                          onChange(`Report ${rule}`, {
                            ...settings,
                            ignoredRules: settings.ignoredRules.filter(
                              (ignored) => ignored !== rule,
                            ),
                          })
                        }
                      >
                        <span className="font-mono">{rule}</span>
                      </SettingItem>
                    ))}
                  </MenuPopup>
                </MenuPositioner>
              </MenuPortal>
            </MenuSubmenuRoot>
          </MenuPopup>
        </MenuPositioner>
      </MenuPortal>
    </Menu>
  );
};

interface SettingItemProps {
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly children: React.ReactNode;
}

/** A menu item with a check mark column, so checked and unchecked items line up. */
const SettingItem = ({ checked, onCheckedChange, children }: SettingItemProps) => (
  <MenuCheckboxItem checked={checked} onCheckedChange={onCheckedChange} className="gap-2">
    <span className="flex size-3.5 shrink-0 items-center justify-center">
      <MenuCheckboxItemIndicator>
        <Check className="size-3.5" />
      </MenuCheckboxItemIndicator>
    </span>
    {children}
  </MenuCheckboxItem>
);
