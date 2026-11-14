import type { SidebearingEdit } from "@shift/types";

/** What a sidebearing field's text asks for, or why it asks for nothing valid. */
export type SidebearingInput =
  | { readonly kind: "edit"; readonly edit: SidebearingEdit }
  | { readonly kind: "invalid"; readonly problem: string };

const NUMBER = /^\d+(\.\d+)?$/;
const SIGNED_NUMBER = /^[+-]\d+(\.\d+)?$/;

/**
 * Reads a sidebearing field as the Set Sidebearings dialog takes it: blank
 * leaves the side alone, a number sets it, `+n` or `−n` adds to it, and
 * `=key` links it.
 *
 * @param keyProblem - why a key cannot be read, or null when it can; the
 * font decides (`Font.metricsKeyProblem`).
 */
export function readSidebearingInput(
  text: string,
  keyProblem: (key: string) => string | null,
): SidebearingInput {
  // A typed minus sign is often the typographic one.
  const trimmed = text.trim().replace("−", "-");
  if (trimmed === "") return { kind: "edit", edit: { kind: "keep" } };

  if (trimmed.startsWith("=")) {
    const problem = keyProblem(trimmed);
    if (problem !== null) return { kind: "invalid", problem };
    return { kind: "edit", edit: { kind: "link", link: trimmed } };
  }
  if (SIGNED_NUMBER.test(trimmed)) {
    return { kind: "edit", edit: { kind: "adjust", adjust: Number(trimmed) } };
  }
  if (NUMBER.test(trimmed)) return { kind: "edit", edit: { kind: "set", set: Number(trimmed) } };

  return { kind: "invalid", problem: "Enter a number, +n or −n to adjust, or =key to link" };
}
