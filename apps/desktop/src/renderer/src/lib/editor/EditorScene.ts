import type { Point2D } from "@shift/geo";
import type { GlyphId, GlyphLayerRecord } from "@shift/types";
import type { AxisLocation } from "@/types/variation";
import { computed, signal, type Signal, type WritableSignal } from "@/lib/signals";
import type { Font } from "@/lib/model/Font";
import type { Glyph, GlyphInstance, GlyphSource } from "@/lib/model/Glyph";

export type SceneGlyphId = string & { readonly __sceneGlyphId: unique symbol };
export type SceneTextRunId = string & { readonly __sceneTextRunId: unique symbol };

export interface SceneGlyphPlacement {
  readonly origin: Point2D;
}

export interface SceneGlyph {
  readonly id: SceneGlyphId;
  readonly glyphId: GlyphId;
  readonly location: AxisLocation;
  readonly placement: SceneGlyphPlacement;
  readonly editable: boolean;
}

export interface SceneTextRun {
  readonly id: SceneTextRunId;
  readonly placement: SceneGlyphPlacement;
}

export interface EditorSceneValue {
  readonly glyphs: readonly SceneGlyph[];
  readonly textRuns: readonly SceneTextRun[];
}

export interface EditorSceneInput {
  readonly glyphs: readonly SceneGlyph[];
  readonly textRuns: readonly SceneTextRun[];
}

const EMPTY_SCENE: EditorSceneValue = { glyphs: [], textRuns: [] };

/**
 * Owns the placed items visible in the editor scene.
 *
 * @remarks
 * Geometry remains owned by {@link Font}. Scene glyphs only point at document
 * glyph identities, choose a designspace location, and place that display
 * result in scene coordinates.
 */
export class EditorScene {
  readonly #font: Font;
  readonly #cell: WritableSignal<EditorSceneValue>;
  readonly #selectedGlyphId: WritableSignal<SceneGlyphId | null>;
  readonly #selectedGlyph: Signal<SceneGlyph | null>;
  readonly #selectedModel: Signal<Glyph | null>;
  readonly #selectedInstance: Signal<GlyphInstance | null>;
  readonly #selectedEditLayer: Signal<GlyphSource | null>;
  readonly #selectedOrigin: Signal<Point2D>;

  constructor(font: Font) {
    this.#font = font;
    this.#cell = signal<EditorSceneValue>(EMPTY_SCENE, { name: "editor.scene" });
    this.#selectedGlyphId = signal<SceneGlyphId | null>(null, {
      name: "editor.scene.selectedGlyphId",
    });
    this.#selectedGlyph = computed(() => this.item(this.#selectedGlyphId.value), {
      name: "editor.scene.selectedGlyph",
    });
    this.#selectedModel = computed(() => this.#model(this.#selectedGlyph.value), {
      name: "editor.scene.selectedModel",
    });
    this.#selectedInstance = computed(() => this.#instance(this.#selectedGlyph.value), {
      name: "editor.scene.selectedInstance",
    });
    this.#selectedEditLayer = computed(() => this.#editLayer(this.#selectedGlyph.value), {
      name: "editor.scene.selectedEditLayer",
    });
    this.#selectedOrigin = computed(
      () => this.#selectedGlyph.value?.placement.origin ?? { x: 0, y: 0 },
      { name: "editor.scene.selectedOrigin" },
    );
  }

  get cell(): Signal<EditorSceneValue> {
    return this.#cell;
  }

  get value(): EditorSceneValue {
    return this.#cell.peek();
  }

  get selectedGlyphIdCell(): Signal<SceneGlyphId | null> {
    return this.#selectedGlyphId;
  }

  get selectedGlyphId(): SceneGlyphId | null {
    return this.#selectedGlyphId.peek();
  }

  get selectedGlyphCell(): Signal<SceneGlyph | null> {
    return this.#selectedGlyph;
  }

  get selectedModelCell(): Signal<Glyph | null> {
    return this.#selectedModel;
  }

  get selectedInstanceCell(): Signal<GlyphInstance | null> {
    return this.#selectedInstance;
  }

  get selectedEditLayerCell(): Signal<GlyphSource | null> {
    return this.#selectedEditLayer;
  }

  get selectedOriginCell(): Signal<Point2D> {
    return this.#selectedOrigin;
  }

  /**
   * Replaces the full scene and selects the first editable glyph.
   *
   * @param scene - Complete scene description. Missing glyphs/layers are left
   *   unresolved; this method does not create document data.
   */
  async set(scene: EditorSceneInput): Promise<void> {
    this.#cell.set({
      glyphs: scene.glyphs.map(copyGlyph),
      textRuns: scene.textRuns.map(copyTextRun),
    });
    this.#selectedGlyphId.set(scene.glyphs.find((item) => item.editable)?.id ?? null);
    await this.#hydrate(scene.glyphs);
    this.#cell.set({
      glyphs: scene.glyphs.map(copyGlyph),
      textRuns: scene.textRuns.map(copyTextRun),
    });
  }

  clear(): void {
    this.#cell.set(EMPTY_SCENE);
    this.#selectedGlyphId.set(null);
  }

  /**
   * Adds one placed glyph to the scene.
   *
   * @param item - Placed glyph occurrence to append.
   */
  async addGlyph(item: SceneGlyph): Promise<void> {
    const scene = this.#cell.peek();
    this.#cell.set({
      glyphs: [...scene.glyphs, copyGlyph(item)],
      textRuns: scene.textRuns,
    });
    if (!this.selectedGlyphId && item.editable) this.#selectedGlyphId.set(item.id);
    await this.#hydrate([item]);
    const hydrated = this.#cell.peek();
    this.#cell.set({
      glyphs: hydrated.glyphs.map(copyGlyph),
      textRuns: hydrated.textRuns,
    });
  }

  items(): readonly SceneGlyph[] {
    return this.#cell.peek().glyphs;
  }

  item(sceneGlyphId: SceneGlyphId | null): SceneGlyph | null {
    if (!sceneGlyphId) return null;
    return this.#cell.peek().glyphs.find((item) => item.id === sceneGlyphId) ?? null;
  }

  model(sceneGlyphId: SceneGlyphId): Glyph | null {
    return this.#model(this.item(sceneGlyphId));
  }

  instance(sceneGlyphId: SceneGlyphId): GlyphInstance | null {
    return this.#instance(this.item(sceneGlyphId));
  }

  layer(sceneGlyphId: SceneGlyphId): GlyphLayerRecord | null {
    const item = this.item(sceneGlyphId);
    if (!item) return null;
    const source = this.#font.sourceAt(item.location);
    if (!source) return null;
    return this.#font.layerForGlyphSource(item.glyphId, source.id);
  }

  editLayer(sceneGlyphId: SceneGlyphId): GlyphSource | null {
    return this.#editLayer(this.item(sceneGlyphId));
  }

  selectGlyph(sceneGlyphId: SceneGlyphId | null): void {
    this.#selectedGlyphId.set(this.item(sceneGlyphId)?.id ?? null);
  }

  setPlacement(sceneGlyphId: SceneGlyphId, placement: SceneGlyphPlacement): void {
    const scene = this.#cell.peek();
    this.#cell.set({
      glyphs: scene.glyphs.map((item) =>
        item.id === sceneGlyphId ? { ...item, placement: copyPlacement(placement) } : item,
      ),
      textRuns: scene.textRuns,
    });
  }

  translatePlacement(sceneGlyphId: SceneGlyphId, delta: Point2D): void {
    const item = this.item(sceneGlyphId);
    if (!item) return;
    this.setPlacement(sceneGlyphId, {
      origin: {
        x: item.placement.origin.x + delta.x,
        y: item.placement.origin.y + delta.y,
      },
    });
  }

  updateGlyph(sceneGlyphId: SceneGlyphId, patch: Partial<Omit<SceneGlyph, "id">>): void {
    const scene = this.#cell.peek();
    this.#cell.set({
      glyphs: scene.glyphs.map((item) =>
        item.id === sceneGlyphId ? copyGlyph({ ...item, ...patch }) : item,
      ),
      textRuns: scene.textRuns,
    });
  }

  toLocal(sceneGlyphId: SceneGlyphId, scenePoint: Point2D): Point2D {
    const origin = this.item(sceneGlyphId)?.placement.origin ?? { x: 0, y: 0 };
    return { x: scenePoint.x - origin.x, y: scenePoint.y - origin.y };
  }

  toScene(sceneGlyphId: SceneGlyphId, localPoint: Point2D): Point2D {
    const origin = this.item(sceneGlyphId)?.placement.origin ?? { x: 0, y: 0 };
    return { x: localPoint.x + origin.x, y: localPoint.y + origin.y };
  }

  async #hydrate(glyphs: readonly SceneGlyph[]): Promise<void> {
    for (const item of glyphs) {
      const source = this.#font.sourceAt(item.location);
      if (!source) continue;
      await this.#font.openGlyph(item.glyphId, source);
      await this.#font.openGlyphSource(item.glyphId, source);
    }
  }

  #model(item: SceneGlyph | null): Glyph | null {
    if (!item) return null;
    const record = this.#font.recordForId(item.glyphId);
    if (!record) return null;
    return this.#font.glyph(this.#font.glyphHandleForName(record.name));
  }

  #instance(item: SceneGlyph | null): GlyphInstance | null {
    const model = this.#model(item);
    if (!model || !item) return null;
    return model.instance(signal(item.location, { name: `editor.scene.${item.id}.location` }));
  }

  #editLayer(item: SceneGlyph | null): GlyphSource | null {
    if (!item?.editable) return null;
    const source = this.#font.sourceAt(item.location);
    if (!source) return null;
    const record = this.#font.recordForId(item.glyphId);
    if (!record) return null;
    return this.#font.glyphSource(this.#font.glyphHandleForName(record.name), source);
  }
}

export function sceneGlyphId(id: string): SceneGlyphId {
  return id as SceneGlyphId;
}

function copyGlyph(item: SceneGlyph): SceneGlyph {
  return {
    ...item,
    placement: copyPlacement(item.placement),
  };
}

function copyTextRun(run: SceneTextRun): SceneTextRun {
  return {
    ...run,
    placement: copyPlacement(run.placement),
  };
}

function copyPlacement(placement: SceneGlyphPlacement): SceneGlyphPlacement {
  return {
    origin: { ...placement.origin },
  };
}
