import { computed, signal, type Signal, type WritableSignal } from "../signals";
import type { SelectableId } from "@/types";

export type HoverEntry = SelectableId;
export type HoverableId = SelectableId;

/**
 * Stores scene-scoped hover identity.
 *
 * Hover is transient identity-only state. It owns no glyph models, glyph layers,
 * geometry, or hit-test policy; tools replace it after resolving scene items.
 */
export class Hover {
  readonly #entry: WritableSignal<HoverEntry | null>;
  readonly #id: Signal<HoverableId | null>;

  constructor() {
    this.#entry = signal<HoverEntry | null>(null, { name: "editor.hover" });
    this.#id = computed(
      () => {
        const entry = this.#entry.value;
        return entry;
      },
      { name: "editor.hover.id" },
    );
  }

  get entryCell(): Signal<HoverEntry | null> {
    return this.#entry;
  }

  get entry(): HoverEntry | null {
    return this.#entry.peek();
  }

  get id(): HoverableId | null {
    return this.#id.peek();
  }

  get hasHover(): boolean {
    return this.#id.peek() !== null;
  }

  isHovered(entry: HoverEntry): boolean {
    return this.has(entry);
  }

  has(id: HoverableId): boolean {
    return this.#id.peek() === id;
  }

  set(entry: HoverEntry | null): void {
    this.#entry.set(entry);
  }

  clear(): void {
    this.#entry.set(null);
  }
}
