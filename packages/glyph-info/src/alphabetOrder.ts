import { ascending, comparing, orderBy, type Comparator } from "@shift/types";

/** Where a character's case puts it: 0 for a capital, 1 for a small letter, 2 when caseless. */
function caseBlockOf(codepoint: number): number {
  const character = String.fromCodePoint(codepoint);
  if (character.toLowerCase() !== character) return 0;
  if (character.toUpperCase() !== character) return 1;
  return 2;
}

// non-reactive: memoizes immutable comparators, never read by computed/effects.
const orderByLocale = new Map<string, Comparator<number>>();

/**
 * Characters in a language's alphabet order, as a type designer lists them:
 * every capital, then every small letter, then caseless characters, each run
 * in the order the language's collation gives (Ukrainian Ґ after Г, Turkish
 * Ç after C, Danish Æ Ø Å after Z).
 *
 * @remarks
 * Code point order is close for a script's basic letters but scatters every
 * letter a language adds beyond them: Russian Ё sorts before А, Serbian Ђ Ј
 * Љ Њ Ћ Џ after Я, accented Latin letters after z. Ties, such as characters
 * the collation ignores, fall back to code point order.
 *
 * @param locale - BCP 47 tag, such as `uk`; `null` for the root collation.
 */
export function alphabetOrder(locale: string | null): Comparator<number> {
  const key = locale ?? "und";
  const cached = orderByLocale.get(key);
  if (cached) return cached;

  const collator = new Intl.Collator(key);
  const order = orderBy<number>(
    comparing(caseBlockOf, ascending),
    (a, b) => collator.compare(String.fromCodePoint(a), String.fromCodePoint(b)),
    ascending,
  );
  orderByLocale.set(key, order);
  return order;
}
