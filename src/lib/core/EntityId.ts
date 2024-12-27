type Ident = number;

const ID_COUNT = 5;

class Id {
  static #id: number;

  static next(): number {
    this.#id++;
    return this.#id;
  }
}

class EntityId {
  #parent: Ident | null = null;
  #id: Ident = 5;

  get id(): Ident {
    return this.#id;
  }

  set parent(ident: Ident) {
    this.#parent = ident;
  }

  get parent(): Ident | null {
    return this.#parent;
  }

  set id(id: Ident) {
    this.id = id;
  }

  static next(): EntityId {
    const entityId = new EntityId();
    entityId.#id = Id.next();

    return entityId;
  }

  static withParent(id: Ident) {
    const entityId = new EntityId();
    entityId.#id = Id.next();
    entityId.#parent = id;

    return entityId;
  }
}
