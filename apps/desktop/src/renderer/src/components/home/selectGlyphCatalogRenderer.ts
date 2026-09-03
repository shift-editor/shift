import type {
  GlyphCatalogRenderer,
  GlyphCatalogRendererSelection,
} from "@/types/glyphCatalogRenderer";

/**
 * Selects Slug or delegates SVG presentation back to the React catalog gate.
 *
 * @remarks
 * Only Slug initialization failure selects SVG. Once Slug is returned, later
 * renderer failures remain owned by Slug and never change the session backend.
 *
 * @param signal - Aborts selection when the owning catalog is disposed.
 * @param createSlug - Initializes the preferred WebGPU renderer.
 * @returns The initialized Slug renderer, or the SVG backend decision.
 * @throws {Error} when selection is aborted.
 */
export async function selectGlyphCatalogRenderer(
  signal: AbortSignal,
  createSlug: () => Promise<GlyphCatalogRenderer>,
): Promise<GlyphCatalogRendererSelection> {
  let slug: GlyphCatalogRenderer | null = null;
  try {
    slug = await createSlug();
    throwIfAborted(signal);
    return { kind: "slug", renderer: slug };
  } catch (error) {
    if (signal.aborted) {
      slug?.destroy();
      throw signal.reason;
    }

    console.warn("Slug glyph catalog initialization failed; using SVG", error);
    return { kind: "svg" };
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason;
}
