import type { FontFeature, TextRunRecord } from "@shift/editor/text";
import type { FeatureGroup, FeatureSetting, FeatureSettingStep } from "@/types/features";
import { featureName } from "../featureNames";

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

/** The headings the Features section lists features under, in order; "Other" takes the rest. */
const GROUPS: readonly { readonly title: string; readonly matches: (tag: string) => boolean }[] = [
  { title: "Ligatures", matches: among("liga", "dlig", "hlig", "clig") },
  {
    title: "Letter case",
    matches: among("smcp", "c2sc", "pcap", "c2pc", "unic", "titl", "case", "cpsp"),
  },
  { title: "Figures", matches: among("onum", "lnum", "tnum", "pnum", "zero") },
  {
    title: "Fractions and positions",
    matches: among("frac", "afrc", "numr", "dnom", "sups", "subs", "sinf", "ordn"),
  },
  { title: "Stylistic sets", matches: (tag) => /^ss\d\d$/.test(tag) },
  { title: "Character variants", matches: (tag) => /^cv\d\d$/.test(tag) },
  { title: "Alternates", matches: among("calt", "salt", "swsh", "cswh", "hist", "nalt", "ornm") },
];

function among(...tags: string[]): (tag: string) => boolean {
  const set = new Set(tags);
  return (tag) => set.has(tag);
}

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

  /** The features under the section's headings, leaving out empty headings. */
  grouped(): FeatureGroup[] {
    const claimed = new Set<FontFeature>();
    const groups: FeatureGroup[] = GROUPS.map(({ title, matches }) => {
      const features = this.all.filter((feature) => matches(feature.tag));
      for (const feature of features) claimed.add(feature);
      return { title, features };
    });
    groups.push({ title: "Other", features: this.all.filter((feature) => !claimed.has(feature)) });
    return groups.filter((group) => group.features.length > 0);
  }
}

function isSwitchable(feature: FontFeature): boolean {
  return feature.default !== "required";
}

function matchesNeedle(feature: FontFeature, needle: string): boolean {
  const name = featureName(feature)?.toLowerCase() ?? "";
  return feature.tag.toLowerCase().includes(needle) || name.includes(needle);
}
