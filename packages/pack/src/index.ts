/**
 * The TypeScript side of `crates/pack`: values packed into flat numbers, in
 * the order Rust declares them, and the transports that carry a request.
 *
 * @remarks
 * Generated code (from `#[derive(Pack)]` and `#[pack::interface]`, see
 * `generate.ts`) declares each type as a schema with {@link struct},
 * {@link list}, {@link option} and {@link variants}, its type as
 * {@link Infer} of that schema, and its own `read` and `write` functions over
 * {@link Reader} and {@link Writer}. A generated interface class sends each
 * method through a {@link SyncTransport}, by the method's index. A method
 * whose Rust result is `Result<T, E>` returns `T`, and throws a
 * {@link PackError} carrying `E`.
 *
 * `Bytes` do not go into the numbers: each crosses whole as a `Uint8Array`
 * in the message's blob list, and the numbers hold its index there.
 */

/** A message's blobs, in the order its `Bytes` values were written. */
export type Blobs = readonly Uint8Array[];

/** The blob list of a message without bytes, shared so such a message allocates none. */
const NO_BLOBS: Blobs = Object.freeze([]);

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
  /** Null until the request writes bytes, so a request without them allocates no list. */
  #blobs: Uint8Array[] | null = null;

  constructor(names: Names) {
    this.#names = names;
  }

  /** Empties the writer for the next request, and returns it. */
  reset(): this {
    this.#length = 0;
    this.#blobs = null;
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

  /** Writes a count, then the numbers, in one copy. */
  numbers(values: ArrayLike<number>): void {
    const end = this.#length + 1 + values.length;
    if (end > this.#values.length) {
      let size = this.#values.length * 2;
      while (size < end) size *= 2;
      const grown = new Float64Array(size);
      grown.set(this.#values.subarray(0, this.#length));
      this.#values = grown;
    }
    this.#values[this.#length++] = values.length;
    this.#values.set(values, this.#length);
    this.#length = end;
  }

  /** Appends `value` to the request's blob list, without copying it, and writes its index there. */
  bytes(value: Uint8Array): void {
    this.#blobs ??= [];
    this.number(this.#blobs.length);
    this.#blobs.push(value);
  }

  /** The numbers written, as a view valid until the next request. */
  finish(): Float64Array {
    return this.#values.subarray(0, this.#length);
  }

  /** The blobs written, in order; one shared empty list when there are none. */
  blobs(): Blobs {
    return this.#blobs ?? NO_BLOBS;
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
  /** The reply's blobs once taken, until then the function that takes them. */
  #blobs: Blobs | (() => Blobs);
  #at = 0;

  /**
   * @param takeBlobs - Returns the reply's blobs. Called once, at the first
   * {@link Reader.bytes}, so a reply without bytes never asks for them.
   */
  constructor(values: Float64Array, names: Names, takeBlobs: () => Blobs = noBlobs) {
    this.#values = values;
    this.#names = names;
    this.#blobs = takeBlobs;
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

  /**
   * Reads a count, then that many numbers as a view of the reply, which is
   * the transport's own copy of the module's output.
   */
  numbers(): Float64Array {
    const count = this.count();
    const start = this.#at;
    this.#at = Math.min(start + count, this.#values.length);
    return this.#values.subarray(start, this.#at);
  }

  /** Reads a blob index and returns that blob; empty for an index past the blob list. */
  bytes(): Uint8Array {
    const index = this.count();
    if (typeof this.#blobs === "function") this.#blobs = this.#blobs();
    return this.#blobs[index] ?? new Uint8Array(0);
  }
}

function noBlobs(): Blobs {
  return NO_BLOBS;
}

/**
 * What a method whose Rust result is `Result<T, E>` throws for an `Err`: the
 * error, as the generated type of `E`.
 *
 * @remarks
 * Narrow it by the Rust enum's TypeScript name, then by `kind`:
 * `if (error instanceof PackError && error.type === "StoreReadError")`.
 */
export class PackError<E = unknown> extends Error {
  /** The error enum's TypeScript name, such as `StoreReadError`. */
  readonly type: string;
  /** The error's variant: the value itself for a unit-only enum, else its `kind`. */
  readonly kind: string;
  /** The error, as its generated type. */
  readonly error: E;

  constructor(type: string, error: E) {
    const kind =
      typeof error === "string" ? error : String((error as { readonly kind?: unknown }).kind);
    super(`${type}.${kind}`);
    this.name = "PackError";
    this.type = type;
    this.kind = kind;
    this.error = error;
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
 * @param request - Sends the method's index, the request's numbers and its
 * blobs, `undefined` for a request without bytes so a module need not read an
 * empty list, and returns the reply's numbers.
 * @param names - The module's name table, so names cross as its ids.
 * @param takeBlobs - Returns the latest reply's blobs, as a WebAssembly
 * module's `takeReplyBlobs`; asked only when a reply reads bytes.
 */
export function syncTransport(
  request: (method: number, numbers: Float64Array, blobs: Blobs | undefined) => Float64Array,
  names: Names,
  takeBlobs: () => Blobs = noBlobs,
): SyncTransport {
  const writer = new Writer(names);
  return {
    writer: () => writer.reset(),
    request: (method, input) => {
      const blobs = input.blobs();
      const numbers = request(method, input.finish(), blobs.length > 0 ? blobs : undefined);
      return new Reader(numbers, names, takeBlobs);
    },
  };
}

/** A reply that carries its blobs with its numbers, as a native module returns one. */
export interface Reply {
  readonly numbers: Float64Array;
  readonly blobs: Blobs;
}

/**
 * Names for one message to or from a module this side shares no name table
 * with: what the message writes is interned in a table of its own, sent as its
 * last blob, and what the reply reads resolves in the table it carries. The
 * TypeScript side of Rust's `pack::CarriedNames`, with the same blob layout:
 * each name's UTF-8 length as a little-endian u32, then its text, in id order.
 */
class CarriedNames implements Names {
  // non-reactive: one message's names, cleared before the next
  readonly #sent = new Map<string, number>();
  #received: readonly string[] = [];

  /** Starts the next request's table, and returns this. */
  reset(): this {
    this.#sent.clear();
    return this;
  }

  id(name: string): number {
    let id = this.#sent.get(name);
    if (id === undefined) {
      id = this.#sent.size;
      this.#sent.set(name, id);
    }
    return id;
  }

  name(id: number): string {
    return this.#received[id] ?? "";
  }

  /** The names this request wrote, as a blob. */
  sentBlob(): Uint8Array {
    const encoder = new TextEncoder();
    const texts = this.#sent
      .keys()
      .map((name) => encoder.encode(name))
      .toArray();
    const blob = new Uint8Array(texts.reduce((total, text) => total + 4 + text.length, 0));
    const view = new DataView(blob.buffer);
    let at = 0;
    for (const text of texts) {
      view.setUint32(at, text.length, true);
      blob.set(text, at + 4);
      at += 4 + text.length;
    }
    return blob;
  }

  /** Resolves the reply's names in `blob`; a malformed table keeps the names before it breaks. */
  receive(blob: Uint8Array | undefined): void {
    const received: string[] = [];
    if (blob) {
      const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
      const decoder = new TextDecoder();
      for (let at = 0; at + 4 <= blob.length; ) {
        const end = at + 4 + view.getUint32(at, true);
        if (end > blob.length) break;
        received.push(decoder.decode(blob.subarray(at + 4, end)));
        at = end;
      }
    }
    this.#received = received;
  }
}

/**
 * A transport to a Rust module this side shares no name table with, such as
 * the native store reader that answers shift-engine's `StoreReader`: the names
 * each message uses travel as its last blob, as Rust's `pack::CarryingNames`
 * sends them and `pack::Packed::answer_carrying_names` answers.
 *
 * @param request - Sends the method's index, the request's numbers and its
 * blobs, and returns the reply.
 */
export function carryingNames(
  request: (method: number, numbers: Float64Array, blobs: Blobs) => Reply,
): SyncTransport {
  const names = new CarriedNames();
  const writer = new Writer(names);
  return {
    writer: () => {
      names.reset();
      return writer.reset();
    },
    request: (method, input) => {
      const reply = request(method, input.finish(), [...input.blobs(), names.sentBlob()]);
      const blobs = reply.blobs.slice(0, -1);
      names.receive(reply.blobs.at(-1));
      return new Reader(reply.numbers, names, () => blobs);
    },
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
/** A run of numbers, read as one `Float64Array` view. */
export const numbers = { kind: "numbers" } as const;
/** A buffer, crossing whole in the message's blob list. */
export const bytes = { kind: "bytes" } as const;

/** An id: a string crossing as the module's interned id, typed by its brand. */
export function id<T extends string>(): { readonly kind: "id"; readonly brand?: T } {
  return { kind: "id" };
}

/** A packed value's shape, as generated code declares it. */
export type Schema =
  | typeof number
  | typeof count
  | typeof flag
  | typeof name
  | typeof numbers
  | typeof bytes
  | { readonly kind: "id"; readonly brand?: string }
  | { readonly kind: "list"; readonly item: Schema }
  | { readonly kind: "option"; readonly inner: Schema }
  | { readonly kind: "variants"; readonly names: readonly string[] }
  | { readonly kind: "struct"; readonly fields: Readonly<Record<string, Schema>> }
  | { readonly kind: "union"; readonly cases: Readonly<Record<string, StructSchema>> };

type StructSchema = { readonly kind: "struct"; readonly fields: Readonly<Record<string, Schema>> };

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

/**
 * An enum whose variants carry fields: the variant's index, then its fields.
 * Read as a union tagged by `kind`, the variant's name.
 */
export function union<C extends Readonly<Record<string, StructSchema>>>(
  cases: C,
): { readonly kind: "union"; readonly cases: C } {
  return { kind: "union", cases };
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
export type Infer<S> = S extends { readonly kind: "id"; readonly brand?: infer T }
  ? T
  : S extends { readonly kind: "numbers" }
    ? Float64Array
    : S extends { readonly kind: "bytes" }
      ? Uint8Array
      : InferValue<S>;

type InferValue<S> = S extends { readonly kind: "number" | "count" }
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
              : S extends { readonly kind: "union"; readonly cases: infer C }
                ? InferCases<C>
                : never;

type InferCases<C> = {
  [K in keyof C]: { readonly kind: K } & (C[K] extends { readonly fields: infer F }
    ? InferFields<F>
    : never);
}[keyof C];
