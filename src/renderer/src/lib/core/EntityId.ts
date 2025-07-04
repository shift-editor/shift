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
}
