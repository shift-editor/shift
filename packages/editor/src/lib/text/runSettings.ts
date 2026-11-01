import type { FeatureSetting } from "@shift/wasm/protocol";
import type { StoredTextRunRecord, TextRunRecord, TextRunSettings } from "../../types/text";

/** A new run's settings, and what a stored run lacking a setting reads as. */
export const DEFAULT_TEXT_RUN_SETTINGS: TextRunSettings = {
  shaping: true,
  features: {},
  language: null,
  script: null,
  lineHeight: null,
  align: null,
};

/** Each stored run that lacked a setting, read once, so it reads as the same object again. */
const completed = new WeakMap<StoredTextRunRecord, TextRunRecord>();

/**
 * A stored run with every setting it lacks at its default: the stored
 * record itself when it has them all, and the same completed record on each
 * read of one that does not.
 */
export function textRunWithDefaults(stored: StoredTextRunRecord): TextRunRecord {
  if (hasEverySetting(stored)) return stored;
  const known = completed.get(stored);
  if (known) return known;

  const { shaping, features, language, script, lineHeight, align } = stored;
  const defaults = DEFAULT_TEXT_RUN_SETTINGS;
  const run: TextRunRecord = {
    ...stored,
    shaping: shaping ?? defaults.shaping,
    features: features ?? defaults.features,
    language: language === undefined ? defaults.language : language,
    script: script === undefined ? defaults.script : script,
    lineHeight: lineHeight === undefined ? defaults.lineHeight : lineHeight,
    align: align === undefined ? defaults.align : align,
  };
  completed.set(stored, run);
  return run;
}

function hasEverySetting(stored: StoredTextRunRecord): stored is TextRunRecord {
  return Object.keys(DEFAULT_TEXT_RUN_SETTINGS).every(
    (setting) => stored[setting as keyof TextRunSettings] !== undefined,
  );
}

/** A run's forced feature as the value layout takes: `1` turns it on, `0` off. */
export function featureValue(on: boolean): number {
  return on ? 1 : 0;
}

/** A run's forced features as layout settings. */
export function featureSettings(features: Readonly<Record<string, boolean>>): FeatureSetting[] {
  return Object.entries(features).map(([tag, on]) => ({ tag, value: featureValue(on) }));
}
