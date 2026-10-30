/**
 * The TypeScript side of `crates/pack`: values packed into flat numbers, in
 * the order Rust declares them, and the transports that carry a request.
 *
 * @remarks
 * Generated code (from `#[derive(Pack)]` and `#[pack::interface]`, see
 * `generate.mjs`) declares each type as a schema with {@link struct},
 * {@link list}, {@link option} and {@link variants}, its type as
 * {@link Infer} of that schema, and its own `read` and `write` functions over
 * {@link Reader} and {@link Writer}. A generated interface class sends each
 * method through a {@link SyncTransport}, by the method's index.
 */

/** Lookups between interned names and their ids, as the module answering a request keeps them. */
export interface Names {
  /** The id of `name`, interned by the module the first time. */
  id(name: string): number;
  /** The name the module's `id` stands for. */
  name(id: number): string;
}

/**
 * Appends a request's numbers.
 *
 * @remarks
 * A transport reuses one writer: {@link Writer.finish} returns a view of its
 * buffer that stays valid until the next request starts writing, which is
 * enough because the module copies its input when called.
 */
export class Writer {
  readonly #names: Names;
  #values = new Float64Array(256);
  #length = 0;

  constructor(names: Names) {
    this.#names = names;
  }

  /** Empties the writer for the next request, and returns it. */
  reset(): this {
    this.#length = 0;
    return this;
  }

  number(value: number): void {
    if (this.#length === this.#values.length) {
      const grown = new Float64Array(this.#values.length * 2);
      grown.set(this.#values);
      this.#values = grown;
    }
    this.#values[this.#length++] = value;
  }

  count(value: number): void {
    this.number(value);
  }

  flag(value: boolean): void {
    this.number(value ? 1 : 0);
  }

  /** Writes a name as its interned id. */
  name(value: string): void {
    this.number(this.#names.id(value));
  }

  /** The numbers written, as a view valid until the next request. */
  finish(): Float64Array {
    return this.#values.subarray(0, this.#length);
  }
}

/**
 * Reads a reply's numbers in order.
 *
 * @remarks
 * Reading past the end yields zeros, as Rust's reader does.
 */
export class Reader {
  readonly #values: Float64Array;
  readonly #names: Names;
  #at = 0;

  constructor(values: Float64Array, names: Names) {
    this.#values = values;
    this.#names = names;
  }

  number(): number {
    return this.#values[this.#at++] ?? 0;
  }

  /** A count: negatives read as zero. */
  count(): number {
    return Math.max(0, this.number());
  }

  flag(): boolean {
    return this.number() !== 0;
  }

  /** Reads an interned id as its name. */
  name(): string {
    return this.#names.name(this.count());
  }
}

/**
 * Carries a generated class's requests to a module that answers them
 * synchronously, such as a WebAssembly module's request export.
 */
export interface SyncTransport {
  /** The writer for the next request, empty. */
  writer(): Writer;
  /** Sends method `method` with what `input` holds, and reads the reply. */
  request(method: number, input: Writer): Reader;
}

/**
 * A transport over a synchronous request function, such as a WebAssembly
 * module's `<trait>Request` export bound to its session.
 *
 * @param names - The module's name table, so names cross as its ids.
 */
export function syncTransport(
  request: (method: number, input: Float64Array) => Float64Array,
  names: Names,
): SyncTransport {
  const writer = new Writer(names);
  return {
    writer: () => writer.reset(),
    request: (method, input) => new Reader(request(method, input.finish()), names),
  };
}

/** A float. */
export const number = { kind: "number" } as const;
/** A whole number that is never negative. */
export const count = { kind: "count" } as const;
/** A boolean. */
export const flag = { kind: "flag" } as const;
/** A string, crossing as the module's interned id. */
export const name = { kind: "name" } as const;

/** A packed value's shape, as generated code declares it. */
export type Schema =
  | typeof number
  | typeof count
  | typeof flag
  | typeof name
  | { readonly kind: "list"; readonly item: Schema }
  | { readonly kind: "option"; readonly inner: Schema }
  | { readonly kind: "variants"; readonly names: readonly string[] }
  | { readonly kind: "struct"; readonly fields: Readonly<Record<string, Schema>> };

/** A count, then that many items. */
export function list<S extends Schema>(item: S): { readonly kind: "list"; readonly item: S } {
  return { kind: "list", item };
}

/** A flag, then the value when present; absent reads as `null`. */
export function option<S extends Schema>(inner: S): { readonly kind: "option"; readonly inner: S } {
  return { kind: "option", inner };
}

/** An enum without data: its variant's index, read as the variant's name. */
export function variants<const N extends readonly string[]>(
  ...names: N
): { readonly kind: "variants"; readonly names: N } {
  return { kind: "variants", names };
}

/** Fields in declaration order. */
export function struct<F extends Readonly<Record<string, Schema>>>(
  fields: F,
): { readonly kind: "struct"; readonly fields: F } {
  return { kind: "struct", fields };
}

type OptionalKeys<F> = {
  [K in keyof F]: F[K] extends { readonly kind: "option" } ? K : never;
}[keyof F];

type InferFields<F> = {
  readonly [K in keyof F as K extends OptionalKeys<F> ? never : K]: Infer<F[K]>;
} & {
  readonly [K in keyof F as K extends OptionalKeys<F> ? K : never]?: Infer<F[K]>;
};

/** The TypeScript type of the values a schema packs. An optional field may be left out. */
export type Infer<S> = S extends { readonly kind: "number" | "count" }
  ? number
  : S extends { readonly kind: "flag" }
    ? boolean
    : S extends { readonly kind: "name" }
      ? string
      : S extends { readonly kind: "list"; readonly item: infer I }
        ? readonly Infer<I>[]
        : S extends { readonly kind: "option"; readonly inner: infer I }
          ? Infer<I> | null
          : S extends { readonly kind: "variants"; readonly names: readonly (infer N)[] }
            ? N
            : S extends { readonly kind: "struct"; readonly fields: infer F }
              ? InferFields<F>
              : never;
