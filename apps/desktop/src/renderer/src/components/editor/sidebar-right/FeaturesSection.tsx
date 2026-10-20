import { useState } from "react";
import type { TextRunRecord } from "@shift/editor/text";
import type { FontFeature } from "@shift/types";
import { Button, cn, Input, Search, Tooltip, X } from "@shift/ui";
import { useEditor } from "@/workspace/WorkspaceContext";
import { featureName } from "../featureNames";
import { FeaturePreviewPopover, TAG_PILL, useFeatureHighlight } from "./FeaturesPanel";
import { groupFeatures, onByDefault, useFontFeatures } from "./fontFeatures";
import { SidebarSection } from "./SidebarSection";
import { useTextSettingsRun } from "./TextSection";

/**
 * Every feature the text can turn on or off, grouped under headings, so
 * rows never come and go; the search icon narrows them by tag or name. As
 * in Fontra and FontGoggles, each row's dot shows its setting and cycles it
 * on click: solid green on, solid red off; at the font's default, pale
 * green when that is on and grey when it is off. Hovering a tag highlights
 * what it changes in the text; clicking it previews the glyphs it brings in.
 */
export const FeaturesSection = () => {
  const target = useTextSettingsRun();
  const features = useFontFeatures();
  // The previewed feature and the tag that opened it, which the preview sits beside.
  const [preview, setPreview] = useState<{ feature: FontFeature; anchor: HTMLElement } | null>(
    null,
  );
  // null while the search field is closed.
  const [query, setQuery] = useState<string | null>(null);
  if (!target || features.length === 0) return null;
  const { run } = target;

  const needle = query?.trim().toLowerCase() ?? "";
  const shown = needle
    ? features.filter(
        (feature) =>
          feature.tag.toLowerCase().includes(needle) ||
          (featureName(feature)?.toLowerCase().includes(needle) ?? false),
      )
    : features;

  return (
    <SidebarSection
      title="Features"
      actions={
        <Tooltip content="Search features">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Search features"
            className="text-sidebar-icon"
            onClick={() => setQuery("")}
          >
            <Search aria-hidden className="h-3.5 w-3.5" />
          </Button>
        </Tooltip>
      }
      header={query === null ? undefined : <SearchField query={query} onChange={setQuery} />}
    >
      {shown.length === 0 ? (
        <p className="flex h-6 items-center text-ui text-secondary">No matching features</p>
      ) : (
        // Eight rows, then the list scrolls.
        <div className="scrollbar-hidden flex max-h-62 flex-col gap-2 overflow-y-auto">
          {groupFeatures(shown).map((group) => (
            <div
              key={group.title}
              role="group"
              aria-label={group.title}
              className="flex flex-col gap-2"
            >
              <h4 className="flex h-5 items-end text-ui text-secondary">{group.title}</h4>
              {group.features.map((feature) => (
                <FeatureRow
                  key={feature.tag}
                  run={run}
                  feature={feature}
                  previewing={preview?.feature.tag === feature.tag}
                  onPreview={(anchor) =>
                    setPreview((current) =>
                      current?.feature.tag === feature.tag ? null : { feature, anchor },
                    )
                  }
                />
              ))}
            </div>
          ))}
        </div>
      )}
      <FeaturePreviewPopover
        run={run}
        feature={preview?.feature ?? null}
        anchor={preview?.anchor ?? null}
        onClose={() => setPreview(null)}
      />
    </SidebarSection>
  );
};

/** The section's title row while searching: a search field, and a button closing it. */
const SearchField = ({
  query,
  onChange,
}: {
  query: string;
  /** The new query, or null to close the search. */
  onChange: (query: string | null) => void;
}) => (
  <>
    <div className="min-w-0 flex-1">
      <Input
        autoFocus
        aria-label="Search features"
        placeholder="Search features"
        icon={<Search aria-hidden className="h-3 w-3 text-muted" />}
        iconPosition="left"
        value={query}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          // Keep Escape and typing out of the canvas's shortcuts.
          event.nativeEvent.stopImmediatePropagation();
          if (event.key === "Escape") onChange(null);
        }}
      />
    </div>
    <Tooltip content="Close search">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Close search"
        className="shrink-0 text-sidebar-icon"
        onClick={() => onChange(null)}
      >
        <X aria-hidden className="h-4 w-4" />
      </Button>
    </Tooltip>
  </>
);

const FeatureRow = ({
  run,
  feature,
  previewing,
  onPreview,
}: {
  run: TextRunRecord;
  feature: FontFeature;
  /** Whether the preview shows this feature. */
  previewing: boolean;
  /** Opens the preview on this feature from its tag, or closes it if open. */
  onPreview: (anchor: HTMLElement) => void;
}) => {
  const editor = useEditor();
  const highlight = useFeatureHighlight(run);
  const name = featureName(feature);
  const setting = run.features[feature.tag] ?? null;
  const state = stateLabel(feature.tag, setting);
  const cycle = (reverse: boolean) => {
    const next = (reverse ? PREVIOUS_SETTING : NEXT_SETTING).get(setting) ?? null;
    editor.history.capture(`Set ${feature.tag} to ${stateLabel(feature.tag, next)}`, () =>
      editor.text.setFeature(run.id, feature.tag, next),
    );
  };

  return (
    <div className="flex h-6 shrink-0 items-center justify-between gap-2 text-ui">
      <span className="flex min-w-0 items-center gap-1.5">
        <button
          type="button"
          data-feature-tag=""
          aria-label={`Preview ${feature.tag}`}
          aria-pressed={previewing}
          className={cn(
            TAG_PILL,
            "cursor-pointer",
            "text-primary",
            previewing ? "bg-icon-button-hover" : "hover:bg-hover",
          )}
          onPointerEnter={() => highlight(feature.tag)}
          onPointerLeave={() => highlight(null)}
          onClick={(event) => onPreview(event.currentTarget)}
        >
          {feature.tag}
        </button>
        {name ? <span className="truncate text-primary">{name}</span> : null}
      </span>
      <Tooltip content={state}>
        <button
          type="button"
          aria-label={`${feature.tag}${name ? `, ${name}` : ""}, ${state}`}
          className="group flex size-6 shrink-0 cursor-pointer items-center justify-center rounded outline-none focus-visible:ring-1 focus-visible:ring-accent"
          onClick={(event) => cycle(event.altKey)}
        >
          <span
            aria-hidden
            className={cn(
              "size-2 rounded-full group-hover:brightness-75",
              dotColor(feature.tag, setting),
            )}
          />
        </button>
      </Tooltip>
    </div>
  );
};

/**
 * Solid green or red while forced on or off. While the font's default holds,
 * pale green if it turns the feature on, grey if it leaves it off; most
 * features are off by default, and red is kept for turning one off.
 */
function dotColor(tag: string, setting: boolean | null): string {
  if (setting === true) return "bg-state-on";
  if (setting === false) return "bg-state-off";
  return onByDefault(tag) ? "bg-state-on/35" : "bg-control-muted";
}

/** Each click moves a feature on: the font's default, then on, then off, then back. */
const NEXT_SETTING = new Map<boolean | null, boolean | null>([
  [null, true],
  [true, false],
  [false, null],
]);
/** Alt-click walks the cycle backwards. */
const PREVIOUS_SETTING = new Map<boolean | null, boolean | null>([
  [null, false],
  [false, true],
  [true, null],
]);

/** A setting as the tooltip names it; the default says what the font does. */
function stateLabel(tag: string, setting: boolean | null): string {
  if (setting === null) return `Default (${onByDefault(tag) ? "on" : "off"})`;
  return setting ? "On" : "Off";
}
