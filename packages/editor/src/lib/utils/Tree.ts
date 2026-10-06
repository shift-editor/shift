/** How {@link Tree.from} reads identity, parent, and sibling order from flat items. */
export interface TreeKeys<Id, Item> {
  readonly id: (item: Item) => Id;
  readonly parentId: (item: Item) => Id | null;
  /** Sibling order; items keep their input order when omitted. */
  readonly order?: (a: Item, b: Item) => number;
}

/**
 * An immutable tree snapshot over flat records that point at their parent.
 *
 * @remarks
 * Build one with {@link Tree.from} whenever the records change, typically
 * inside a computed. An item whose parent is missing is a root, and an item on
 * a parent cycle is dropped from the walk rather than looping.
 */
export class Tree<Id, Item> {
  readonly #byId: ReadonlyMap<Id, Item>;
  readonly #parentById: ReadonlyMap<Id, Id | null>;
  readonly #childrenById: ReadonlyMap<Id, readonly Item[]>;
  readonly #roots: readonly Item[];
  readonly #order: readonly Item[];
  readonly #id: (item: Item) => Id;

  private constructor(items: Iterable<Item>, keys: TreeKeys<Id, Item>) {
    this.#id = keys.id;
    const byId = new Map<Id, Item>();
    for (const item of items) byId.set(keys.id(item), item);

    const parentById = new Map<Id, Id | null>();
    const childrenById = new Map<Id, Item[]>();
    const roots: Item[] = [];
    for (const [id, item] of byId) {
      const parentId = keys.parentId(item);
      const parent = parentId !== null && byId.has(parentId) ? parentId : null;
      parentById.set(id, parent);
      if (parent === null) {
        roots.push(item);
        continue;
      }
      const siblings = childrenById.get(parent);
      if (siblings) siblings.push(item);
      else childrenById.set(parent, [item]);
    }

    if (keys.order) {
      roots.sort(keys.order);
      for (const siblings of childrenById.values()) siblings.sort(keys.order);
    }

    this.#byId = byId;
    this.#parentById = parentById;
    this.#childrenById = childrenById;
    this.#roots = roots;
    this.#order = depthFirst(roots, childrenById, keys.id);
  }

  /** Builds a tree from flat items; later items with a repeated id replace earlier ones. */
  static from<Id, Item>(items: Iterable<Item>, keys: TreeKeys<Id, Item>): Tree<Id, Item> {
    return new Tree(items, keys);
  }

  get(id: Id): Item | null {
    return this.#byId.get(id) ?? null;
  }

  roots(): readonly Item[] {
    return this.#roots;
  }

  /** Returns an item's children in sibling order; empty for leaves and unknown ids. */
  children(id: Id): readonly Item[] {
    return this.#childrenById.get(id) ?? [];
  }

  /** Returns an item's parent, or null for roots and unknown ids. */
  parent(id: Id): Item | null {
    const parentId = this.#parentById.get(id) ?? null;
    return parentId === null ? null : this.get(parentId);
  }

  /** Yields an item's ancestors, nearest first. */
  *ancestors(id: Id): Iterable<Item> {
    const seen = new Set<Id>([id]);
    let parent = this.parent(id);
    while (parent) {
      const parentId = this.#id(parent);
      if (seen.has(parentId)) return;
      seen.add(parentId);
      yield parent;
      parent = this.parent(parentId);
    }
  }

  /** Yields an item's descendants depth-first, parents before children. */
  *descendants(id: Id): Iterable<Item> {
    for (const child of depthFirst(this.children(id), this.#childrenById, this.#id)) yield child;
  }

  /** Returns every reachable item depth-first, parents before children. */
  walk(): readonly Item[] {
    return this.#order;
  }
}

function depthFirst<Id, Item>(
  starts: readonly Item[],
  childrenById: ReadonlyMap<Id, readonly Item[]>,
  id: (item: Item) => Id,
): Item[] {
  const ordered: Item[] = [];
  const seen = new Set<Id>();
  const visit = (item: Item): void => {
    const itemId = id(item);
    if (seen.has(itemId)) return;
    seen.add(itemId);
    ordered.push(item);
    for (const child of childrenById.get(itemId) ?? []) visit(child);
  };
  for (const start of starts) visit(start);
  return ordered;
}
