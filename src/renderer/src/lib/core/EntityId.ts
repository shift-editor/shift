export type Ident = number;
const NO_PARENT_ID = 0;

class Id {
  static #id: number = 0;

  static next(): Ident {
    this.#id++;
    return this.#id;
  }
}

export class EntityId {
  readonly parentId: Ident = NO_PARENT_ID;
  readonly id: Ident;

  constructor(parentId?: Ident) {
    if (parentId) {
      this.parentId = parentId;
    }
    this.id = Id.next();
  }

  /**
   * Create an EntityId from a string (e.g., from Rust snapshot IDs).
   * Note: This creates a new EntityId with a fresh internal ID but preserves
   * the string representation for cross-boundary compatibility.
   */
  static fromString(idStr: string): EntityId {
    // For now, just create a new EntityId
    // The actual string ID is stored in the Rust snapshot
    return new EntityId();
  }

  /**
   * Convert to string representation.
   */
  toString(): string {
    return String(this.id);
  }
}
