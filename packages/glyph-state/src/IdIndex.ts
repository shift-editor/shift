type IdSelector<Value, Id> = (value: Value) => Id;
type ValueList<Value> = () => readonly Value[];

/**
 * Lazily maps domain objects by ID while preserving the caller's list owner.
 *
 * `IdIndex` accepts a supplier instead of owning storage. Immutable callers can
 * return the same array forever; reactive callers can return a computed array.
 * The ID map is rebuilt only when the supplied array identity changes.
 */
export class IdIndex<Id, Value> {
  readonly #values: ValueList<Value>;
  readonly #id: IdSelector<Value, Id>;
  #byIdSource: readonly Value[] | null = null;
  #byId: ReadonlyMap<Id, Value> | null = null;

  constructor(values: ValueList<Value>, id: IdSelector<Value, Id>) {
    this.#values = values;
    this.#id = id;
  }

  get all(): readonly Value[] {
    return this.#values();
  }

  get(id: Id): Value | null {
    return this.byId.get(id) ?? null;
  }

  get byId(): ReadonlyMap<Id, Value> {
    const all = this.all;
    if (this.#byId === null || this.#byIdSource !== all) {
      this.#byId = new Map(all.map((value) => [this.#id(value), value]));
      this.#byIdSource = all;
    }
    return this.#byId;
  }
}
