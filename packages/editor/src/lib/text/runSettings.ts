import type { StoredTextRunRecord, TextRunRecord, TextRunSettings } from "../../types/text";

/** A new run's settings, and what a stored run lacking a setting reads as. */
export const DEFAULT_TEXT_RUN_SETTINGS: TextRunSettings = {
  shaping: true,
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

  const { shaping } = stored;
  const defaults = DEFAULT_TEXT_RUN_SETTINGS;
  const run: TextRunRecord = {
    ...stored,
    shaping: shaping ?? defaults.shaping,
  };
  completed.set(stored, run);
  return run;
}

function hasEverySetting(stored: StoredTextRunRecord): stored is TextRunRecord {
  return Object.keys(DEFAULT_TEXT_RUN_SETTINGS).every(
    (setting) => stored[setting as keyof TextRunSettings] !== undefined,
  );
}
