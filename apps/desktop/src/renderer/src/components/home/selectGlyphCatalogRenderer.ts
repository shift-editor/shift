import type {
  GlyphCatalogRenderer,
  GlyphCatalogRendererSelection,
} from "@/types/glyphCatalogRenderer";

/**
 * Selects one glyph catalog renderer for the caller-owned workspace session.
 *
 * @remarks
 * Only Slug initialization failure selects SVG. Once returned, the selection
 * is immutable; later renderer failures remain owned by the selected backend.
 *
 * @param signal - Aborts selection without constructing the SVG fallback.
 * @param createSlug - Initializes the preferred WebGPU renderer.
 * @param createSvg - Constructs the fallback after a non-abort initialization failure.
 * @returns The one renderer selection the caller must retain and destroy.
 * @throws {Error} when selection is aborted or SVG construction fails.
 */
export async function selectGlyphCatalogRenderer(
  signal: AbortSignal,
  createSlug: () => Promise<GlyphCatalogRenderer>,
  createSvg: () => GlyphCatalogRenderer,
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
    const renderer = createSvg();
    return { kind: "svg", renderer };
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason;
}
