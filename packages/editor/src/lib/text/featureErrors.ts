import type { FeatureListError } from "@shift/wasm/protocol";

/** What the editor says when a font's features cannot be read and it does not know why. */
const UNKNOWN = "This font's features can't be read right now.";

/**
 * The sentence the editor shows when a font's features, or a feature's
 * substitutions, cannot be read: one per {@link FeatureListError} kind.
 */
export function featureReadMessage(error: unknown): string {
  const listError = featureListError(error);
  if (!listError) return UNKNOWN;
  switch (listError.kind) {
    case "noShaper":
      return "This font has no shaper yet, so its features can't be listed.";
    case "unreadable":
      return "This font's compiled features can't be read, so its features can't be listed.";
    case "invalidTag":
      return `“${listError.tag}” isn't a feature tag, so its substitutions can't be shown.`;
  }
}

/** The {@link FeatureListError} the engine threw, read from the error it arrives in. */
function featureListError(error: unknown): FeatureListError | null {
  if (typeof error !== "object" || error === null) return null;
  const { type, error: carried } = error as { readonly type?: unknown; readonly error?: unknown };
  if (type !== "FeatureListError") return null;
  return carried as FeatureListError;
}
