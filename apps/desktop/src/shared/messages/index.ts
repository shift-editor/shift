import englishMessages from "./en.json";

/**
 * Formats a catalog entry with values supplied by the presenting surface.
 *
 * @param id - Stable identifier shared by every locale catalog.
 * @param values - Dynamic values referenced by braces in the catalog entry.
 * @returns the localized message with every supplied value interpolated.
 */
export function message(
  id: keyof typeof englishMessages,
  values: Readonly<Record<string, string | number>> = {},
): string {
  return englishMessages[id].replace(/\{([^}]+)\}/g, (placeholder, name: string) => {
    const value = values[name];
    return value === undefined ? placeholder : String(value);
  });
}
