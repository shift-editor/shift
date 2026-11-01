import type { FontFeature, TextRunRecord } from "@shift/editor/text";
import type { FeatureGroup, FeatureSetting, FeatureSettingStep } from "@/types/features";

/**
 * Each setting a feature's dot shows, and the cycle a click walks: the
 * font's default, then on, then off, then back; Alt-click walks it backwards.
 * Solid green and red mark a forced setting; at the default the dot is pale
 * green when the font turns the feature on and grey when it leaves it off,
 * so red is kept for turning one off.
 */
const SETTINGS = {
  default: {
    next: "on",
    previous: "off",
    override: null,
    label: (onByDefault) => `Default (${onByDefault ? "on" : "off"})`,
    dot: (onByDefault) => (onByDefault ? "bg-state-on/35" : "bg-control-muted"),
  },
  on: {
    next: "off",
    previous: "default",
    override: true,
    label: () => "On",
    dot: () => "bg-state-on",
  },
  off: {
    next: "default",
    previous: "on",
    override: false,
    label: () => "Off",
    dot: () => "bg-state-off",
  },
} as const satisfies Record<FeatureSetting, FeatureSettingStep>;

/** A feature's setting in a run. */
export function featureSetting(run: TextRunRecord, tag: string): FeatureSetting {
  const override = run.features[tag];
  if (override === undefined) return "default";

  return override ? "on" : "off";
}

/** How the Features section shows and cycles a setting. */
export function settingStep(setting: FeatureSetting): FeatureSettingStep {
  return SETTINGS[setting];
}

/** Whether the font turns a feature on for text that leaves it at its default. */
export function onByDefault(feature: FontFeature): boolean {
  return feature.default === "on";
}

/** The heading each feature group is listed under, in the order the Features section lists them. */
const HEADINGS: readonly (readonly [FontFeature["group"], string])[] = [
  ["ligatures", "Ligatures"],
  ["letterCase", "Letter case"],
  ["figures", "Figures"],
  ["fractionsAndPositions", "Fractions and positions"],
  ["stylisticSets", "Stylistic sets"],
  ["characterVariants", "Character variants"],
  ["alternates", "Alternates"],
  ["other", "Other"],
];

/**
 * The features a text can turn on or off, in tag order: every feature the
 * font defines but those the shaper always applies.
 */
export class FontFeatures {
  readonly all: readonly FontFeature[];

  private constructor(features: readonly FontFeature[]) {
    this.all = features;
  }

  /** The features of `features` that text can switch; required ones stay out. */
  static switchable(features: readonly FontFeature[]): FontFeatures {
    return new FontFeatures(features.filter(isSwitchable));
  }

  get isEmpty(): boolean {
    return this.all.length === 0;
  }

  /** The features whose tag or shown name contains `query`; all of them for a blank query. */
  matching(query: string): FontFeatures {
    const needle = query.trim().toLowerCase();
    if (needle === "") return this;

    return new FontFeatures(this.all.filter((feature) => matchesNeedle(feature, needle)));
  }

  /** The features under the section's headings, by the group Rust gives each, leaving out empty headings. */
  grouped(): FeatureGroup[] {
    return HEADINGS.map(([group, title]) => ({
      title,
      features: this.all.filter((feature) => feature.group === group),
    })).filter((heading) => heading.features.length > 0);
  }
}

function isSwitchable(feature: FontFeature): boolean {
  return feature.default !== "required";
}

function matchesNeedle(feature: FontFeature, needle: string): boolean {
  const name = feature.name?.toLowerCase() ?? "";
  return feature.tag.toLowerCase().includes(needle) || name.includes(needle);
}

/** What a failed read of the font's features says, for the sidebar. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
