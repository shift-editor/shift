import type { Editor } from "@shift/editor";
import { localPoint, type LocalPoint } from "@shift/editor/spaces";
import type { MatModel, Point2D } from "@shift/geo";
import type { GlyphName } from "@shift/types";

/** The components the canvas draws beside those an exact source's layer holds. */
export interface DrawnAndAuthoredComponents {
  readonly renderedIds: string[];
  readonly exactIds: string[];
  /** Each transform as `[a, b, c, d, e, f]`. */
  readonly renderedTransforms: number[][];
  readonly exactTransforms: number[][];
}

/**
 * Reads of the glyph the canvas draws between sources, for E2E specs.
 *
 * @remarks
 * Served through the E2E hook for test launches only. These wait on the open-glyph refactor's
 * `drawnGlyph` read (#824); once it lands, each moves onto it and this class goes.
 */
export class InterpolatedReads {
  readonly #editor: Editor;

  constructor(editor: Editor) {
    this.#editor = editor;
  }

  /**
   * Canvas-local positions on the open glyph as the canvas draws it now, interpolated where the
   * location is between sources: its first point, the middle of its first segment, and empty
   * canvas 15px below the glyph's descender at half its advance.
   */
  glyphClickTargets(): Point2D[] {
    const editor = this.#editor;
    const node = editor.scene.first("glyph")!;
    const glyph = editor.glyphForId(node.glyphId)!;
    const geometry = glyph.geometryAt(editor.externalLocation);
    const point = geometry.allPoints[0]!;
    const segment = geometry.segments[0]!.pointAt(0.5);
    const view = glyph.renderModelAt(editor.externalLocationCell, editor.activeSourceIdCell);
    const metrics = editor.font.metricsAtLocation(editor.externalLocation);
    return [
      point,
      segment,
      {
        x: view.xAdvanceCell.peek() / 2,
        y: metrics.descender - editor.camera.screenToSceneDistance(15),
      },
    ].map((target) => editor.sceneToScreen(editor.toScene(node, target as LocalPoint)));
  }

  /** How many points the open glyph draws at the editor's location, interpolated between sources. */
  drawnPointCount(): number {
    const editor = this.#editor;
    const node = editor.scene.first("glyph");
    if (!node) return 0;

    const geometry = editor.glyphForId(node.glyphId)?.geometryAt(editor.externalLocation);
    return geometry?.allPoints.length ?? 0;
  }

  /** How many components the open glyph draws at the editor's location, interpolated between sources. */
  drawnComponentCount(): number {
    const editor = this.#editor;
    const node = editor.scene.first("glyph");
    const glyph = node ? editor.glyphForId(node.glyphId) : null;
    if (!glyph) throw new Error("Expected a loaded open glyph");

    return glyph.renderModelAt(editor.externalLocationCell, editor.activeSourceIdCell).components
      .length;
  }

  /**
   * The direct components the canvas draws for the glyph named `glyphName` at the editor's
   * location beside those its layer at the source named `sourceName` holds.
   */
  drawnAndAuthoredComponents(glyphName: string, sourceName: string): DrawnAndAuthoredComponents {
    const editor = this.#editor;
    const record = editor.font.recordForName(glyphName as GlyphName);
    if (!record) throw new Error(`Expected ${glyphName} fixture glyph`);
    const source = editor.font.sourceNamed(sourceName);
    if (!source) throw new Error(`Expected ${sourceName} fixture source`);
    const glyph = editor.glyphForId(record.id);
    if (!glyph) throw new Error(`Expected loaded ${glyphName} glyph`);

    const renderModel = glyph.renderModelAt(editor.externalLocationCell, editor.activeSourceIdCell);
    const exactGeometry = glyph.geometryForSource(source.id);
    const directComponents = renderModel.components.filter(
      (component) => component.parentPath.length === 0,
    );
    const matrixValues = (matrix: MatModel) => [
      matrix.a,
      matrix.b,
      matrix.c,
      matrix.d,
      matrix.e,
      matrix.f,
    ];

    return {
      renderedIds: directComponents.map((component) => component.componentId),
      exactIds: exactGeometry.components.map((component) => component.id),
      renderedTransforms: directComponents.map((component) => matrixValues(component.transform)),
      exactTransforms: exactGeometry.components.map((component) => matrixValues(component.matrix)),
    };
  }

  /**
   * The live position of the `u` glyph's `top` anchor in its default-source layer, a drag's
   * uncommitted preview included.
   */
  liveUTopAnchor(): LocalPoint {
    const editor = this.#editor;
    const record = editor.font.recordForName("u" as GlyphName);
    const layer = record
      ? editor.glyphForId(record.id)?.layerForSource(editor.font.defaultSource.id)
      : null;
    const anchor = layer?.anchors.find((candidate) => candidate.name === "top");
    if (!anchor) throw new Error("Expected u's top anchor");

    return localPoint(anchor.x, anchor.y);
  }
}
