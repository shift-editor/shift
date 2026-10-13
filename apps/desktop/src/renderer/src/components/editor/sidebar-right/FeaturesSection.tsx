import { useEffect, useState } from "react";
import type { FontFeature } from "@shift/types";
import { useSignalState } from "@shift/editor/signals";
import {
  Button,
  cn,
  Input,
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuTrigger,
  RotateCcw,
  Search,
  Switch,
  Tooltip,
} from "@shift/ui";
import HorizontalEllipsis from "@/assets/general/horizontal-ellipsis.svg";
import { useEditor } from "@/workspace/WorkspaceContext";
import { SidebarSection } from "./SidebarSection";
import { featureName } from "../featureNames";
import { featureCodeOpenCell } from "../feature-code/featureCodeState";

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
  const errorCount = useFeatureErrorCount();
  // null while the search field is closed.
  const [query, setQuery] = useState<string | null>(null);
  if (!run || features.length === 0) return null;

  const overridden = Object.keys(run.features).length > 0;
  const needle = query?.trim().toLowerCase() ?? "";
  const shown = needle
    ? features.filter(
        (feature) =>
          feature.tag.toLowerCase().includes(needle) ||
          (featureName(feature)?.toLowerCase().includes(needle) ?? false),
      )
    : features;
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
        <div className="flex items-center">
          {errorCount > 0 ? <FeatureErrorBadge count={errorCount} /> : null}
          <Tooltip content="Search features">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Search features"
              aria-pressed={query !== null}
              isActive={query !== null}
              className="text-sidebar-icon"
              onClick={() => setQuery((current) => (current === null ? "" : null))}
            >
              <Search aria-hidden className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
          <FeaturesMenu
            canReset={overridden}
            onReset={() =>
              editor.history.capture("Reset features", () => editor.text.resetFeatures(run.id))
            }
          />
        </div>
      }
    >
      {query !== null ? (
        <Input
          autoFocus
          aria-label="Search features"
          placeholder="Search features..."
          icon={<Search aria-hidden className="h-3 w-3 text-muted" />}
          iconPosition="left"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            // Keep Escape and typing out of the canvas's shortcuts.
            event.nativeEvent.stopImmediatePropagation();
            if (event.key === "Escape") setQuery(null);
          }}
        />
      ) : null}
      {/* About ten rows tall at most; a font with many features scrolls inside the section. */}
      <ul className="flex max-h-80 scrollbar-hidden flex-col gap-1.5 overflow-y-auto">
        {shown.length === 0 ? (
          <li className="flex h-6 shrink-0 items-center text-ui text-secondary">
            No matching features
          </li>
        ) : null}
        {shown.map((feature) => (
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
          <MenuItem onClick={() => featureCodeOpenCell.set(true)}>Edit Feature Code…</MenuItem>
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
  const name = featureName(feature);
  const on = override ?? ON_BY_DEFAULT.has(feature.tag);
  const label = name ? `${feature.tag}, ${name}` : feature.tag;

  return (
    <li className="flex h-6 shrink-0 items-center gap-2">
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
  const featureRevision = useSignalState(editor.font.featureRevisionCell);
  // Glyph names generate features too: a new `a.ss04` adds ss04.
  const glyphs = useSignalState(editor.font.glyphEntriesCell);
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
  }, [editor, featureRevision, glyphs]);
  return features;
}

/** How many errors the compiler reports in the font's feature code. */
function useFeatureErrorCount(): number {
  const editor = useEditor();
  const featureRevision = useSignalState(editor.font.featureRevisionCell);
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (editor.sessionMode !== "workspace") return;
    let current = true;
    editor.font
      .featureDiagnostics()
      .then((diagnostics) => {
        if (!current) return;
        setCount(diagnostics.filter((diagnostic) => diagnostic.severity === "error").length);
      })
      .catch((error: unknown) => console.error("failed to read feature diagnostics", error));
    return () => {
      current = false;
    };
  }, [editor, featureRevision]);
  return count;
}

/** The count of feature code errors; opens the feature code window to fix them. */
const FeatureErrorBadge = ({ count }: { readonly count: number }) => {
  const label = count === 1 ? "1 error in feature code" : `${count} errors in feature code`;
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        className="mr-1 rounded-full bg-error px-1.5 text-xs leading-4 font-semibold text-on-accent"
        onClick={() => featureCodeOpenCell.set(true)}
      >
        {count}
      </button>
    </Tooltip>
  );
};
