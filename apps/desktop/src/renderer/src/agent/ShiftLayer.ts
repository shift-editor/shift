import type {
  AuthoredLayer,
  LayerAppearance,
  LayerOverlays,
  LayerSvg,
  ResolvedLayer,
} from "@shift/runtime";
import type {
  GlyphId,
  GlyphLayerSnapshot,
  LayerId,
  LayerRead,
  ResolvedLayerGeometry,
  ResolvedOutline,
  SourceId,
  SourceMetrics,
} from "@shift/types";
import { GlyphGeometry } from "@shift/glyph-state";
import { renderLayerSvg } from "@shift/editor/rendering";
import type { Font } from "@shift/editor/model";

type LayerReader = Pick<Font, "readLayers" | "resolveLayers">;

/**
 * One authored layer from a single accepted-state read, with its public views.
 *
 * @remarks
 * `authored()`, `resolved()`, and `render()` all derive from the same read, so
 * they always agree on identity and geometry. A layer read with
 * {@link ShiftLayer.readAuthored} skips component resolution: it stays
 * readable when a component is broken, but cannot resolve or render.
 */
export class ShiftLayer {
  readonly #snapshot: GlyphLayerSnapshot;
  readonly #geometry: GlyphGeometry;
  readonly #resolved: ResolvedLayerGeometry | null;

  private constructor(snapshot: GlyphLayerSnapshot, resolved: ResolvedLayerGeometry | null) {
    this.#snapshot = snapshot;
    this.#geometry = GlyphGeometry.fromState(snapshot.state);
    this.#resolved = resolved;
  }

  /**
   * Reads one layer with its components resolved at the layer's own source.
   *
   * @throws {Error} when the layer is unknown or a component cannot resolve.
   */
  static async read(font: LayerReader, layerId: LayerId): Promise<ShiftLayer> {
    const [read] = await font.resolveLayers([layerId]);
    return ShiftLayer.fromRead(requireRead(read, layerId));
  }

  /**
   * Reads one layer's authored state only.
   *
   * @throws {Error} when the layer is unknown.
   */
  static async readAuthored(font: LayerReader, layerId: LayerId): Promise<ShiftLayer> {
    const [snapshot] = await font.readLayers([layerId]);
    return ShiftLayer.fromSnapshot(requireRead(snapshot, layerId));
  }

  /** Wraps an authored snapshot from a batch read; the layer cannot resolve or render. */
  static fromSnapshot(snapshot: GlyphLayerSnapshot): ShiftLayer {
    return new ShiftLayer(snapshot, null);
  }

  /** Wraps one batch read that carries both authored and resolved geometry. */
  static fromRead({ authored, resolved }: LayerRead): ShiftLayer {
    return new ShiftLayer(authored, resolved);
  }

  get identity(): { glyphId: GlyphId; sourceId: SourceId; layerId: LayerId } {
    const { glyphId, sourceId, state } = this.#snapshot;
    return { glyphId, sourceId, layerId: state.layerId };
  }

  /** Public authored view: nested contours, components, and anchors. */
  authored(): AuthoredLayer {
    const geometry = this.#geometry;
    return {
      ...this.identity,
      advanceWidth: geometry.xAdvance,
      bounds: geometry.bounds,
      contours: geometry.contours.map((contour) => ({
        id: contour.id,
        closed: contour.closed,
        points: contour.points.map(({ id, x, y, pointType, smooth }) => ({
          id,
          x,
          y,
          pointType,
          smooth,
        })),
      })),
      components: geometry.components.map((component) => {
        const matrix = component.matrix;
        return {
          id: component.id,
          baseGlyphId: component.baseGlyphId,
          baseGlyphName: component.baseGlyphName,
          transformation: {
            xx: matrix.a,
            xy: matrix.b,
            yx: matrix.c,
            yy: matrix.d,
            dx: matrix.e,
            dy: matrix.f,
          },
        };
      }),
      anchors: geometry.anchors.map(({ id, name, x, y }) => ({
        id,
        name: name ?? null,
        x,
        y,
      })),
    };
  }

  /** Public resolved view: composited outline and direct component subtrees. */
  resolved(): ResolvedLayer {
    const resolved = this.#requireResolved();
    return {
      ...this.identity,
      advanceWidth: this.#geometry.xAdvance,
      outline: publicOutline(resolved.outline),
      components: resolved.components.map(({ id, baseGlyphId, transformation, outline }) => ({
        id,
        baseGlyphId,
        transformation,
        outline: publicOutline(outline),
      })),
    };
  }

  /** Portable SVG of this layer with the given source metrics and annotations. */
  render(
    metrics: SourceMetrics,
    { overlays, appearance }: { overlays?: LayerOverlays; appearance?: LayerAppearance } = {},
  ): LayerSvg {
    const rendered = renderLayerSvg({
      authored: this.#geometry,
      resolved: this.#requireResolved(),
      metrics,
      overlays,
      appearance,
    });
    return { ...this.identity, ...rendered };
  }

  #requireResolved(): ResolvedLayerGeometry {
    if (!this.#resolved) {
      throw new Error(`Layer ${this.identity.layerId} was read without resolved geometry`);
    }
    return this.#resolved;
  }
}

function requireRead<Read>(read: Read | undefined, layerId: LayerId): Read {
  if (!read) throw new Error(`Layer ${layerId} was not returned`);
  return read;
}

function publicOutline({ svgPath, bounds }: ResolvedOutline) {
  return { svgPath, bounds: bounds ?? null };
}
