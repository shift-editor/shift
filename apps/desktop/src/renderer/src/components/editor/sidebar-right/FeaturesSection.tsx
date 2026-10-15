import { useEffect, useState } from "react";
import type { FontFeature } from "@shift/types";
import { useSignalState } from "@shift/editor/signals";
import {
  Button,
  cn,
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuTrigger,
  RotateCcw,
  Switch,
  Tooltip,
} from "@shift/ui";
import HorizontalEllipsis from "@/assets/general/horizontal-ellipsis.svg";
import { useEditor } from "@/workspace/WorkspaceContext";
import { SidebarSection } from "./SidebarSection";

/** Features a script's shaping needs or export generates; they stay out of the list. */
const REQUIRED_FEATURES = new Set([
  "aalt",
  "abvf",
  "abvm",
  "abvs",
  "akhn",
  "blwf",
  "blwm",
  "blws",
  "ccmp",
  "cfar",
  "cjct",
  "curs",
  "dist",
  "fin2",
  "fin3",
  "fina",
  "half",
  "haln",
  "init",
  "isol",
  "kern",
  "ljmo",
  "locl",
  "mark",
  "med2",
  "medi",
  "mkmk",
  "nukt",
  "pref",
  "pres",
  "pstf",
  "psts",
  "rclt",
  "rkrf",
  "rlig",
  "rphf",
  "rvrn",
  "stch",
  "tjmo",
  "vjmo",
  "vatu",
]);

/** Registered names for common features, shown when the font names none. */
const FEATURE_NAMES: Readonly<Record<string, string>> = {
  afrc: "Alternative Fractions",
  c2sc: "Small Capitals From Capitals",
  calt: "Contextual Alternates",
  case: "Case-Sensitive Forms",
  clig: "Contextual Ligatures",
  cpsp: "Capital Spacing",
  dlig: "Discretionary Ligatures",
  dnom: "Denominators",
  frac: "Fractions",
  hist: "Historical Forms",
  liga: "Standard Ligatures",
  lnum: "Lining Figures",
  numr: "Numerators",
  onum: "Oldstyle Figures",
  ordn: "Ordinals",
  pnum: "Proportional Figures",
  salt: "Stylistic Alternates",
  sinf: "Scientific Inferiors",
  smcp: "Small Capitals",
  subs: "Subscript",
  sups: "Superscript",
  swsh: "Swash",
  titl: "Titling",
  tnum: "Tabular Figures",
  zero: "Slashed Zero",
};

/** Features a shaper applies unless told otherwise; every other listed feature starts off. */
const ON_BY_DEFAULT = new Set(["calt", "clig", "liga"]);

/**
 * The font's features for the proof text the user is working in, each on or
 * off. A feature set away from the font's default reads in full; ones left
 * at the default are muted, as Kerning mutes unset values.
 */
export const FeaturesSection = () => {
  const editor = useEditor();
  const run = useSignalState(editor.text.currentRunCell);
  const features = useFontFeatures();
  if (!run || features.length === 0) return null;

  const overridden = Object.keys(run.features).length > 0;
  const setFeature = (tag: string, on: boolean | null) =>
    editor.history.capture(
      on === null ? `Use default ${tag}` : `Turn ${on ? "on" : "off"} ${tag}`,
      () =>
        // Back at the font's default, the feature stops being an override.
        editor.text.setFeature(run.id, tag, on === ON_BY_DEFAULT.has(tag) ? null : on),
    );

  return (
    <SidebarSection
      title="Features"
      actions={
        <FeaturesMenu
          canReset={overridden}
          onReset={() =>
            editor.history.capture("Reset features", () => editor.text.resetFeatures(run.id))
          }
        />
      }
    >
      <ul className="flex flex-col gap-1.5">
        {features.map((feature) => (
          <FeatureRow
            key={feature.tag}
            feature={feature}
            override={run.features[feature.tag] ?? null}
            onChange={(on) => setFeature(feature.tag, on)}
          />
        ))}
      </ul>
    </SidebarSection>
  );
};

interface FeaturesMenuProps {
  readonly canReset: boolean;
  readonly onReset: () => void;
}

/** The section's settings menu; always shown, so the header never shifts. */
const FeaturesMenu = ({ canReset, onReset }: FeaturesMenuProps) => (
  <Menu modal={false}>
    <Tooltip content="Feature settings">
      <MenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Feature settings"
            className="text-sidebar-icon"
          />
        }
      >
        <HorizontalEllipsis className="h-5 w-5 text-icon-subtle" />
      </MenuTrigger>
    </Tooltip>
    <MenuPortal>
      <MenuPositioner sideOffset={4} align="end">
        <MenuPopup>
          <MenuItem disabled={!canReset} onClick={onReset}>
            Reset All Features
          </MenuItem>
        </MenuPopup>
      </MenuPositioner>
    </MenuPortal>
  </Menu>
);

interface FeatureRowProps {
  readonly feature: FontFeature;
  /** This text's setting, or null at the font's default. */
  readonly override: boolean | null;
  /** Sets the feature on or off for this text, or back to the font's default with null. */
  readonly onChange: (on: boolean | null) => void;
}

/** A feature's tag, its name, and its control; text reads in full while the feature is on. */
const FeatureRow = ({ feature, override, onChange }: FeatureRowProps) => {
  const name = feature.name ?? FEATURE_NAMES[feature.tag] ?? featureFamilyName(feature.tag);
  const on = override ?? ON_BY_DEFAULT.has(feature.tag);
  const label = name ? `${feature.tag}, ${name}` : feature.tag;

  return (
    <li className="flex h-6 items-center gap-2">
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span
          className={cn(
            "shrink-0 rounded bg-input px-1.5 py-0.5 font-mono text-ui",
            on ? "text-primary" : "text-secondary",
          )}
        >
          {feature.tag}
        </span>
        {name ? <FeatureName name={name} on={on} /> : null}
      </span>
      <InheritedControl label={label} on={on} override={override} onChange={onChange} />
    </li>
  );
};

/** A feature's name, cut off to fit, with the full name on hover when it is. */
const FeatureName = ({ name, on }: { readonly name: string; readonly on: boolean }) => {
  // Whether the name is cut off, measured when the pointer arrives.
  const [truncated, setTruncated] = useState(false);
  return (
    <Tooltip disabled={!truncated} content={name}>
      <span
        className={cn("min-w-0 truncate text-ui", on ? "text-primary" : "text-secondary")}
        onPointerEnter={(event) =>
          setTruncated(event.currentTarget.scrollWidth > event.currentTarget.clientWidth)
        }
      >
        {name}
      </span>
    </Tooltip>
  );
};

interface ControlProps {
  readonly label: string;
  readonly override: boolean | null;
  readonly onChange: (on: boolean | null) => void;
}

/**
 * The feature's actual state as a switch; a changed feature also shows a
 * button back to the font's default, as Kerning shows a remove button on a set value.
 */
const InheritedControl = ({ label, on, override, onChange }: ControlProps & { on: boolean }) => (
  <>
    <div className="flex w-6 shrink-0 justify-center">
      {override !== null ? (
        <Tooltip content="Reset to font default">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Reset ${label} to font default`}
            className="text-sidebar-icon"
            onClick={() => onChange(null)}
          >
            <RotateCcw aria-hidden className="h-3.5 w-3.5" />
          </Button>
        </Tooltip>
      ) : null}
    </div>
    <Switch checked={on} aria-label={label} onCheckedChange={onChange} />
  </>
);

/** Lists the font's user-facing features; empty in a preview, which has no shaping. */
function useFontFeatures(): readonly FontFeature[] {
  const editor = useEditor();
  const [features, setFeatures] = useState<readonly FontFeature[]>([]);
  useEffect(() => {
    if (editor.sessionMode !== "workspace") return;
    let current = true;
    editor.font
      .features()
      .then((all) => {
        if (current) setFeatures(all.filter((feature) => !REQUIRED_FEATURES.has(feature.tag)));
      })
      .catch((error: unknown) => console.error("failed to list font features", error));
    return () => {
      current = false;
    };
  }, [editor]);
  return features;
}

/** Names numbered stylistic sets and character variants, such as "Stylistic Set 1". */
function featureFamilyName(tag: string): string | null {
  const number = Number.parseInt(tag.slice(2), 10);
  if (tag.startsWith("ss") && number > 0) return `Stylistic Set ${number}`;
  if (tag.startsWith("cv") && number > 0) return `Character Variant ${number}`;
  return null;
}
