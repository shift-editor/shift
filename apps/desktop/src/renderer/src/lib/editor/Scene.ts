import type { Point2D } from "@shift/geo";
import { mintItemId, type GlyphId, type ItemId } from "@shift/types";
import type { AxisLocation } from "@/types/variation";
import { cloneAxisLocation } from "@/lib/variation/location";
import { signal, type Signal, type WritableSignal } from "@/lib/signals";

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

export type SceneItem = SceneGlyph;

export interface PlaceGlyphInput {
  readonly id?: ItemId;
  readonly glyphId: GlyphId;
  readonly location: AxisLocation;
  readonly origin: Point2D;
}

export interface SceneValue {
  readonly items: readonly SceneItem[];
  readonly geometryItems: readonly ItemId[];
}

export interface SceneInput {
  readonly items: readonly SceneItem[];
  readonly geometryItems?: readonly ItemId[];
}

const EMPTY_SCENE: SceneValue = { items: [], geometryItems: [] };

/**
 * Owns the placed items visible in the editor scene.
 *
 * @remarks
 * Scene stores placement identity, display location, and which item ids should
 * show structured geometry. It does not resolve glyph models or glyph layers,
 * and it does not decide what authored data a command mutates.
 */
export class Scene {
  readonly #cell: WritableSignal<SceneValue>;

  constructor() {
    this.#cell = signal<SceneValue>(EMPTY_SCENE, { name: "editor.scene" });
  }

  /** Reactive scene value for renderers and panels. */
  get cell(): Signal<SceneValue> {
    return this.#cell;
  }

  /** Current scene snapshot. */
  get value(): SceneValue {
    return this.#cell.peek();
  }

  /** Returns all placed scene items as a read-only snapshot. */
  items(): readonly SceneItem[] {
    return this.#cell.peek().items;
  }

  /** Returns all placed glyph items as a read-only snapshot. */
  glyphItems(): readonly SceneGlyph[] {
    return this.#cell.peek().items.filter(isSceneGlyph);
  }

  /** Returns item ids currently rendered with structured geometry. */
  geometryItemIds(): readonly ItemId[] {
    return this.#cell.peek().geometryItems;
  }

  /**
   * Resolves a placed scene item by id.
   *
   * @param itemId - Placement identity to resolve; `null` resolves to `null`.
   * @returns The placed item, or `null` when the item is no longer in the scene.
   */
  item(itemId: ItemId | null): SceneItem | null {
    if (!itemId) return null;
    return this.#cell.peek().items.find((item) => item.id === itemId) ?? null;
  }

  /**
   * Resolves a placed glyph item by id.
   *
   * @param itemId - Placement identity to resolve; `null` resolves to `null`.
   * @returns The placed glyph item, or `null` when the item is absent or not a glyph.
   */
  glyphItem(itemId: ItemId | null): SceneGlyph | null {
    const item = this.item(itemId);
    return item?.kind === "glyph" ? item : null;
  }

  /**
   * Replaces every scene item and geometry visibility state.
   *
   * @param scene - Complete scene description. Items are copied by value; glyph
   *   models and layers are not loaded or created.
   */
  set(scene: SceneInput): void {
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
   * @param options - Optional placement identity, display location, and origin.
   * @returns The item id for the placed glyph.
   */
  placeGlyph(input: PlaceGlyphInput): ItemId {
    const id = input.id ?? mintItemId();
    const item: SceneGlyph = {
      id,
      kind: "glyph",
      glyphId: input.glyphId,
      location: cloneAxisLocation(input.location),
      placement: { origin: { ...input.origin } },
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
   * Shows structured geometry for a placed scene item.
   *
   * @param itemId - Placement identity whose geometry should be shown.
   */
  showGeometry(itemId: ItemId): void {
    if (!this.item(itemId) || this.isGeometryShown(itemId)) return;
    const scene = this.#cell.peek();
    this.#cell.set({ ...scene, geometryItems: [...scene.geometryItems, itemId] });
  }

  /**
   * Hides structured geometry for a placed scene item.
   *
   * @param itemId - Placement identity whose geometry should be hidden.
   */
  hideGeometry(itemId: ItemId): void {
    const scene = this.#cell.peek();
    this.#cell.set({
      ...scene,
      geometryItems: scene.geometryItems.filter((existing) => existing !== itemId),
    });
  }

  /**
   * Replaces the complete set of items whose structured geometry is shown.
   *
   * @param itemIds - Placement identities to show with structured geometry.
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
   * Returns whether structured geometry is shown for a scene item.
   *
   * @param itemId - Placement identity to inspect.
   */
  isGeometryShown(itemId: ItemId): boolean {
    return this.#cell.peek().geometryItems.includes(itemId);
  }

  /**
   * Replaces a scene item's placement.
   *
   * @param itemId - Placement identity whose placement is updated.
   * @param placement - New placement in scene coordinates.
   */
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
   * @param itemId - Placement identity whose origin is updated.
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
   * @param itemId - Placement identity whose origin is updated.
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

  /**
   * Updates display-only fields for a placed glyph item.
   *
   * @param itemId - Placement identity for the glyph item to update.
   * @param patch - Replacement display data; does not mutate authored glyph geometry.
   */
  updateGlyphItem(itemId: ItemId, patch: Partial<Omit<SceneGlyph, "id" | "kind">>): void {
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

  /**
   * Converts a scene-space point into a placed item's local coordinate space.
   *
   * @param itemId - Placement identity that supplies the local origin.
   * @param scenePoint - Point in scene coordinates.
   * @returns Local point, or `null` when the item is not in the scene.
   */
  toLocal(itemId: ItemId, scenePoint: Point2D): Point2D | null {
    const origin = this.item(itemId)?.placement.origin;
    if (!origin) return null;
    return { x: scenePoint.x - origin.x, y: scenePoint.y - origin.y };
  }

  /**
   * Converts a placed item's local point into scene-space coordinates.
   *
   * @param itemId - Placement identity that supplies the local origin.
   * @param localPoint - Point in the placed item's local coordinates.
   * @returns Scene-space point, or `null` when the item is not in the scene.
   */
  toScene(itemId: ItemId, localPoint: Point2D): Point2D | null {
    const origin = this.item(itemId)?.placement.origin;
    if (!origin) return null;
    return { x: localPoint.x + origin.x, y: localPoint.y + origin.y };
  }
}

function isSceneGlyph(item: SceneItem): item is SceneGlyph {
  return item.kind === "glyph";
}

function copyItem<T extends SceneItem>(item: T): T {
  return {
    ...item,
    placement: copyPlacement(item.placement),
    location: cloneAxisLocation(item.location),
  };
}

function copyPlacement(placement: ScenePlacement): ScenePlacement {
  return {
    origin: { ...placement.origin },
  };
}
