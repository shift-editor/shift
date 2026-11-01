/** One row a sidebar picker offers. */
export interface PickerChoice {
  readonly key: string;
  readonly label: string;
  /** Muted text at the row's end, such as a language's script. */
  readonly detail?: string;
}

/** A row of a picker's panel: a choice, or the unsetting row with a null key. */
export interface PickerRow {
  readonly key: string | null;
  readonly label: string;
  readonly detail?: string;
}

/** The languages a picker offers, and the BCP 47 tag each choice sets by its key. */
export interface LanguageChoices {
  readonly choices: readonly PickerChoice[];
  readonly tags: ReadonlyMap<string, string>;
}
