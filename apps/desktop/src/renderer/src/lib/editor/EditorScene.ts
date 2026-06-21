import type { Point2D } from "@shift/geo";
import type { GlyphId } from "@shift/types";
import type { AxisLocation } from "@/types/variation";
import { signal, type Signal, type WritableSignal } from "@/lib/signals";

declare const crypto: { getRandomValues<T extends Uint8Array>(array: T): T };

const SHORT_ID_ALPHABET = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
const SHORT_ID_SUFFIX_LENGTH = 10;
const SHORT_ID_ALPHABET_MASK = SHORT_ID_ALPHABET.length - 1;

export type ItemId = string & { readonly __itemId: unique symbol };
export type TextRunId = string & { readonly __textRunId: unique symbol };

export interface ScenePlacement {
  readonly origin: Point2D;
}

export interface SceneGlyph {
  readonly id: ItemId;
  readonly kind: "glyph";
  readonly glyphId: GlyphId;
  readonly location: AxisLocation;
  readonly placement: ScenePlacement;
}

export interface SceneTextRun {
  readonly id: ItemId;
  readonly kind: "textRun";
  readonly textRunId: TextRunId;
  readonly placement: ScenePlacement;
}

export type SceneItem = SceneGlyph | SceneTextRun;

export interface EditorSceneValue {
  readonly items: readonly SceneItem[];
  readonly geometryItems: readonly ItemId[];
}

export interface EditorSceneInput {
  readonly items: readonly SceneItem[];
  readonly geometryItems?: readonly ItemId[];
}

const EMPTY_SCENE: EditorSceneValue = { items: [], geometryItems: [] };

/**
 * Owns the scene items visible in the editor canvas.
 *
 * @remarks
 * Scene stores item identity, display location, placement, and which items
 * show structured geometry. It does not resolve glyph models, glyph layers, or
 * mutation capability; callers compose scene items with `Font`/`Glyph` when
 * they need those concepts.
 */
export class EditorScene {
  readonly #cell: WritableSignal<EditorSceneValue>;

  constructor() {
    this.#cell = signal<EditorSceneValue>(EMPTY_SCENE, { name: "editor.scene" });
  }

  get cell(): Signal<EditorSceneValue> {
    return this.#cell;
  }

  get value(): EditorSceneValue {
    return this.#cell.peek();
  }

  items(): readonly SceneItem[] {
    return this.#cell.peek().items;
  }

  glyphItems(): readonly SceneGlyph[] {
    return this.#cell.peek().items.filter(isSceneGlyph);
  }

  geometryItemIds(): readonly ItemId[] {
    return this.#cell.peek().geometryItems;
  }

  item(itemId: ItemId | null): SceneItem | null {
    if (!itemId) return null;
    return this.#cell.peek().items.find((item) => item.id === itemId) ?? null;
  }

  glyphItem(itemId: ItemId | null): SceneGlyph | null {
    const item = this.item(itemId);
    return item?.kind === "glyph" ? item : null;
  }

  /**
   * Replaces every scene item and the set of items showing structured geometry.
   *
   * @param scene - Complete scene description. Items are copied by value; glyph
   *   models and layers are not loaded or created.
   */
  set(scene: EditorSceneInput): void {
    const items = scene.items.map(copyItem);
    const itemIds = new Set(items.map((item) => item.id));
    const geometryItems = (scene.geometryItems ?? []).filter((itemId) => itemIds.has(itemId));
    this.#cell.set({ items, geometryItems });
  }

  /** Clears all scene items and geometry visibility state. */
  clear(): void {
    this.#cell.set(EMPTY_SCENE);
  }

  /**
   * Places one glyph item in the scene.
   *
   * @param glyphId - Document glyph identity to display.
   * @param options - Scene identity, display location, and origin.
   * @returns The scene item id for the placed glyph.
   */
  placeGlyph(
    glyphId: GlyphId,
    options: { id?: ItemId; location: AxisLocation; origin: Point2D },
  ): ItemId {
    const id = options.id ?? mintItemId();
    const item: SceneGlyph = {
      id,
      kind: "glyph",
      glyphId,
      location: copyAxisLocation(options.location),
      placement: { origin: { ...options.origin } },
    };
    const scene = this.#cell.peek();
    const items = [...scene.items.filter((existing) => existing.id !== id), item];
    this.#cell.set({
      items,
      geometryItems: scene.geometryItems.filter((itemId) => itemId !== id),
    });
    return id;
  }

  /**
   * Replaces the scene with one glyph item.
   *
   * @param glyphId - Document glyph identity to display.
   * @param options - Scene identity, display location, and origin.
   * @returns The scene item id for the placed glyph.
   */
  replaceWithGlyph(
    glyphId: GlyphId,
    options: { id?: ItemId; location: AxisLocation; origin: Point2D },
  ): ItemId {
    const id = options.id ?? mintItemId();
    this.set({
      items: [
        {
          id,
          kind: "glyph",
          glyphId,
          location: copyAxisLocation(options.location),
          placement: { origin: { ...options.origin } },
        },
      ],
      geometryItems: [],
    });
    return id;
  }

  /**
   * Shows structured geometry for a scene item.
   *
   * @param itemId - Scene item whose geometry should be shown.
   */
  showGeometry(itemId: ItemId): void {
    if (!this.item(itemId) || this.isGeometryShown(itemId)) return;
    const scene = this.#cell.peek();
    this.#cell.set({ ...scene, geometryItems: [...scene.geometryItems, itemId] });
  }

  /**
   * Hides structured geometry for a scene item.
   *
   * @param itemId - Scene item whose geometry should be hidden.
   */
  hideGeometry(itemId: ItemId): void {
    const scene = this.#cell.peek();
    this.#cell.set({
      ...scene,
      geometryItems: scene.geometryItems.filter((existing) => existing !== itemId),
    });
  }

  /**
   * Replaces the complete set of scene items whose structured geometry is shown.
   *
   * @param itemIds - Scene item ids to show as structured geometry.
   */
  setGeometryItems(itemIds: readonly ItemId[]): void {
    const scene = this.#cell.peek();
    const validIds = new Set(scene.items.map((item) => item.id));
    const geometryItems: ItemId[] = [];
    for (const itemId of itemIds) {
      if (!validIds.has(itemId) || geometryItems.includes(itemId)) continue;
      geometryItems.push(itemId);
    }
    this.#cell.set({ ...scene, geometryItems });
  }

  /**
   * Returns whether a scene item is currently shown as structured geometry.
   *
   * @param itemId - Scene item to inspect.
   */
  isGeometryShown(itemId: ItemId): boolean {
    return this.#cell.peek().geometryItems.includes(itemId);
  }

  setPlacement(itemId: ItemId, placement: ScenePlacement): void {
    const scene = this.#cell.peek();
    this.#cell.set({
      ...scene,
      items: scene.items.map((item) =>
        item.id === itemId ? copyItem({ ...item, placement: copyPlacement(placement) }) : item,
      ),
    });
  }

  /**
   * Sets a scene item's origin to an absolute scene-space position.
   *
   * @param itemId - Scene item whose placement is updated.
   * @param origin - Destination origin in scene coordinates.
   */
  moveItemTo(itemId: ItemId, origin: Point2D): void {
    const item = this.item(itemId);
    if (!item) return;
    this.setPlacement(itemId, { ...item.placement, origin: { ...origin } });
  }

  /**
   * Offsets a scene item's origin by a scene-space delta.
   *
   * @param itemId - Scene item whose placement is updated.
   * @param delta - Relative movement in scene coordinates.
   */
  moveItemBy(itemId: ItemId, delta: Point2D): void {
    const item = this.item(itemId);
    if (!item) return;
    this.moveItemTo(itemId, {
      x: item.placement.origin.x + delta.x,
      y: item.placement.origin.y + delta.y,
    });
  }

  updateGlyph(itemId: ItemId, patch: Partial<Omit<SceneGlyph, "id" | "kind">>): void {
    const scene = this.#cell.peek();
    this.#cell.set({
      ...scene,
      items: scene.items.map((item) =>
        item.id === itemId && item.kind === "glyph"
          ? copyItem({ ...item, ...patch, kind: "glyph" })
          : item,
      ),
    });
  }

  toLocal(itemId: ItemId, scenePoint: Point2D): Point2D {
    const origin = this.item(itemId)?.placement.origin ?? { x: 0, y: 0 };
    return { x: scenePoint.x - origin.x, y: scenePoint.y - origin.y };
  }

  toScene(itemId: ItemId, localPoint: Point2D): Point2D {
    const origin = this.item(itemId)?.placement.origin ?? { x: 0, y: 0 };
    return { x: localPoint.x + origin.x, y: localPoint.y + origin.y };
  }
}

export function asItemId(id: string): ItemId {
  return id as ItemId;
}

export function mintItemId(): ItemId {
  const bytes = new Uint8Array(SHORT_ID_SUFFIX_LENGTH);
  crypto.getRandomValues(bytes);

  let suffix = "";
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    suffix += SHORT_ID_ALPHABET[byte & SHORT_ID_ALPHABET_MASK];
  }
  return `item_${suffix}` as ItemId;
}

function isSceneGlyph(item: SceneItem): item is SceneGlyph {
  return item.kind === "glyph";
}

function copyItem<T extends SceneItem>(item: T): T {
  return {
    ...item,
    placement: copyPlacement(item.placement),
    ...("location" in item ? { location: copyAxisLocation(item.location) } : {}),
  } as T;
}

function copyPlacement(placement: ScenePlacement): ScenePlacement {
  return {
    origin: { ...placement.origin },
  };
}

function copyAxisLocation(location: AxisLocation): AxisLocation {
  return new Map(location);
}
