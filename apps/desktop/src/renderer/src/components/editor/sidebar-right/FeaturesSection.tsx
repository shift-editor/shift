import { useEffect, useMemo, useState } from "react";
import type { FontFeature, TextRunRecord } from "@shift/editor/text";
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
  Search,
  Tooltip,
  X,
} from "@shift/ui";
import HorizontalEllipsis from "@/assets/general/horizontal-ellipsis.svg";
import { useEditor } from "@/workspace/WorkspaceContext";
import { featureName } from "../featureNames";
import { FeaturePreviewPopover, TAG_PILL } from "./FeaturePreviewPopover";
import { featureSetting, FontFeatures, onByDefault, settingStep } from "./fontFeatures";
import { useSidebarBlock } from "./SidebarGroup";
import { SidebarSection } from "./SidebarSection";
import { useTextSettingsRun } from "./TextSection";

/**
 * Every feature the text can turn on or off, grouped under headings, so
 * rows never come and go; the search icon narrows them by tag or name. As
 * in Fontra and FontGoggles, each row's dot shows its setting and cycles it
 * on click. Hovering a tag highlights what it changes in the text; clicking
 * it previews the glyphs it brings in.
 */
export const FeaturesSection = () => {
  const editor = useEditor();
  const target = useTextSettingsRun();
  const fontFeatures = useSignalState(editor.text.featuresCell);
  const features = useMemo(() => FontFeatures.switchable(fontFeatures), [fontFeatures]);
  const block = useSidebarBlock();
  const [previewed, setPreviewed] = useState<FontFeature | null>(null);
  // null while the search field is closed.
  const [query, setQuery] = useState<string | null>(null);
  // Hover highlights end with the section, so none outlives it.
  useEffect(() => () => editor.text.setFeatureHighlight(null), [editor]);
  if (!target || features.isEmpty) return null;

  const { run } = target;
  const groups = features.matching(query ?? "").grouped();
  const togglePreview = (feature: FontFeature) =>
    setPreviewed((current) => (current?.tag === feature.tag ? null : feature));

  return (
    <SidebarSection
      title="Features"
      actions={
        <div className="flex items-center">
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
          <FeaturesMenu
            canReset={Object.keys(run.features).length > 0}
            onReset={() =>
              editor.history.capture("Reset features", () => editor.text.resetFeatures(run.id))
            }
          />
        </div>
      }
      header={query === null ? undefined : <SearchField query={query} onChange={setQuery} />}
    >
      {groups.length === 0 ? (
        <p className="flex h-6 items-center text-ui text-secondary">No matching features</p>
      ) : (
        // Eight rows, then the list scrolls.
        <div className="scrollbar-hidden flex max-h-62 flex-col gap-2 overflow-y-auto">
          {groups.map((group) => (
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
                  previewing={previewed?.tag === feature.tag}
                  onPreview={() => togglePreview(feature)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
      <FeaturePreviewPopover
        run={run}
        feature={previewed}
        anchor={block}
        onClose={() => setPreviewed(null)}
      />
    </SidebarSection>
  );
};

interface SearchFieldProps {
  readonly query: string;
  /** The new query, or null to close the search. */
  readonly onChange: (query: string | null) => void;
}

/** The section's title row while searching: a search field, and a button closing it. */
const SearchField = ({ query, onChange }: SearchFieldProps) => (
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
  readonly run: TextRunRecord;
  readonly feature: FontFeature;
  /** Whether the preview shows this feature. */
  readonly previewing: boolean;
  /** Opens the preview on this feature, or closes it if it shows this feature. */
  readonly onPreview: () => void;
}

/** A feature's tag, which previews it, its name, and the dot that cycles its setting. */
const FeatureRow = ({ run, feature, previewing, onPreview }: FeatureRowProps) => {
  const editor = useEditor();
  const name = featureName(feature);
  const defaultOn = onByDefault(feature);
  const setting = featureSetting(run, feature.tag);
  const step = settingStep(setting);
  const label = step.label(defaultOn);
  const highlight = (on: boolean) =>
    editor.text.setFeatureHighlight(on ? { runId: run.id, tag: feature.tag } : null);
  const cycle = (reverse: boolean) => {
    const next = settingStep(reverse ? step.previous : step.next);
    editor.history.capture(`Set ${feature.tag} to ${next.label(defaultOn)}`, () =>
      editor.text.setFeature(run.id, feature.tag, next.override),
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
            "cursor-pointer text-primary",
            previewing ? "bg-icon-button-hover" : "hover:bg-hover",
          )}
          onPointerEnter={() => highlight(true)}
          onPointerLeave={() => highlight(false)}
          onClick={onPreview}
        >
          {feature.tag}
        </button>
        {name ? <span className="truncate text-primary">{name}</span> : null}
      </span>
      <Tooltip content={label}>
        <button
          type="button"
          aria-label={`${feature.tag}${name ? `, ${name}` : ""}, ${label}`}
          className="group flex size-6 shrink-0 cursor-pointer items-center justify-center rounded outline-none focus-visible:ring-1 focus-visible:ring-accent"
          onClick={(event) => cycle(event.altKey)}
        >
          <span
            aria-hidden
            className={cn("size-2 rounded-full group-hover:brightness-75", step.dot(defaultOn))}
          />
        </button>
      </Tooltip>
    </div>
  );
};
