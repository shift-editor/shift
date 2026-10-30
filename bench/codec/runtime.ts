// Throwaway prototype of the boundary plan's schema runtime (phase c bench gate).
// A schema is plain data; codec(schema) walks it once into read/write closures,
// cached in a WeakMap keyed by the schema. No eval / new Function.
import { nameFor, nameId } from "../../packages/wasm/src/names";

/** Same buffer and semantics as @shift/wasm/numbers' NumberWriter, plus a bulk write. */
export class Writer {
  static #shared: Writer | null = null;
  #values = new Float64Array(256);
  #length = 0;

  static shared(): Writer {
    Writer.#shared ??= new Writer();
    Writer.#shared.#length = 0;
    return Writer.#shared;
  }

  number(value: number): void {
    if (this.#length === this.#values.length) this.#grow(this.#length + 1);
    this.#values[this.#length++] = value;
  }

  count(value: number): void {
    this.number(value);
  }

  flag(value: boolean): void {
    this.number(value ? 1 : 0);
  }

  /** list(number), emitted inline by the "emitted-lists" variant. */
  numberList(values: readonly number[]): void {
    this.number(values.length);
    for (const value of values) this.number(value);
  }

  /** list(count). */
  counts(values: readonly number[]): void {
    this.number(values.length);
    for (const value of values) this.number(value);
  }

  /** list(T) with T's emitted writer. */
  list<T>(values: readonly T[], item: (write: Writer, value: T) => void): void {
    this.number(values.length);
    for (const value of values) item(this, value);
  }

  numbers(values: Float64Array): void {
    this.number(values.length);
    if (this.#length + values.length > this.#values.length) this.#grow(this.#length + values.length);
    this.#values.set(values, this.#length);
    this.#length += values.length;
  }

  finish(): Float64Array {
    return this.#values.subarray(0, this.#length);
  }

  #grow(needed: number): void {
    let size = this.#values.length * 2;
    while (size < needed) size *= 2;
    const grown = new Float64Array(size);
    grown.set(this.#values);
    this.#values = grown;
  }
}

/** Same semantics as NumberReader (reads past the end yield 0), plus a bulk view read. */
export class Reader {
  readonly #values: Float64Array;
  #at = 0;

  constructor(values: Float64Array) {
    this.#values = values;
  }

  number(): number {
    return this.#values[this.#at++] ?? 0;
  }

  count(): number {
    return Math.max(0, this.number());
  }

  flag(): boolean {
    return this.number() !== 0;
  }

  /** list(number) as number[], like NumberReader.list(() => read.number()). */
  numberList(): number[] {
    const n = this.count();
    const items: number[] = [];
    for (let i = 0; i < n; i++) items.push(this.number());
    return items;
  }

  /** list(count). */
  counts(): number[] {
    const n = this.count();
    const items: number[] = [];
    for (let i = 0; i < n; i++) items.push(this.count());
    return items;
  }

  /** list(T) with T's emitted reader. */
  list<T>(item: (read: Reader) => T): T[] {
    const n = this.count();
    const items: T[] = [];
    for (let i = 0; i < n; i++) items.push(item(this));
    return items;
  }

  /** A view of the next `count` numbers; the reply buffer is the module's fresh copy. */
  numbers(): Float64Array {
    const count = this.count();
    const start = this.#at;
    if (start + count > this.#values.length) throw new Error("numbers past the end");
    this.#at += count;
    return this.#values.subarray(start, start + count);
  }
}

export type Schema =
  | { readonly kind: "number" }
  | { readonly kind: "count" }
  | { readonly kind: "bool" }
  | { readonly kind: "string" }
  | { readonly kind: "numbers" }
  | { readonly kind: "struct"; readonly fields: Readonly<Record<string, Schema>>; readonly emitted?: Codec }
  | { readonly kind: "list"; readonly item: Schema }
  | { readonly kind: "option"; readonly inner: Schema }
  | { readonly kind: "names"; readonly names: readonly string[]; readonly emitted?: Codec }
  | { readonly kind: "variant"; readonly tag: string; readonly cases: Readonly<Record<string, Schema>> };

export const number = { kind: "number" } as const;
export const count = { kind: "count" } as const;
export const bool = { kind: "bool" } as const;
export const string = { kind: "string" } as const;
export const numbers = { kind: "numbers" } as const;
/** `emitted`: the generator's read/write for this type, as ordinary source literals (the "emitted" variant). */
export const struct = <F extends Record<string, Schema>>(fields: F, emitted?: Codec) => ({ kind: "struct", fields, emitted }) as const;
export const list = <S extends Schema>(item: S) => ({ kind: "list", item }) as const;
export const option = <S extends Schema>(inner: S) => ({ kind: "option", inner }) as const;
/** A unit enum, as its variant names (`PointType`). */
export const names = <N extends string>(...values: N[]) => ({ kind: "names", names: values }) as const;
/** A unit enum with the generator's read/write emitted as literals. */
export const namesEmitted = <N extends string>(values: N[], emitted: Codec) => ({ kind: "names", names: values, emitted }) as const;
/** A data enum: the case index, then that case's struct, read as `{ [tag]: name, ...fields }`. */
export const variant = <C extends Record<string, Schema>>(tag: string, cases: C) => ({ kind: "variant", tag, cases }) as const;

export interface Codec {
  read(read: Reader): any;
  write(write: Writer, value: any): void;
}

const codecs = new WeakMap<Schema, Codec>();

export function codec(schema: Schema): Codec {
  let found = codecs.get(schema);
  if (found === undefined) {
    found = build(schema);
    codecs.set(schema, found);
  }
  return found;
}

const NUMBER: Codec = { read: (r) => r.number(), write: (w, v) => w.number(v as number) };
const COUNT: Codec = { read: (r) => r.count(), write: (w, v) => w.number(v as number) };
const BOOL: Codec = { read: (r) => r.number() !== 0, write: (w, v) => w.number(v ? 1 : 0) };
const STRING: Codec = { read: (r) => nameFor(r.count()), write: (w, v) => w.number(nameId(v as string)) };
const NUMBERS: Codec = { read: (r) => r.numbers(), write: (w, v) => w.numbers(v as Float64Array) };

function build(schema: Schema): Codec {
  // Any schema may carry the generator's emitted codec (emitted variants).
  const emitted = (schema as { emitted?: Codec }).emitted;
  if (emitted) return emitted;
  switch (schema.kind) {
    case "number":
      return NUMBER;
    case "count":
      return COUNT;
    case "bool":
      return BOOL;
    case "string":
      return STRING;
    case "numbers":
      return NUMBERS;
    case "list":
      return listCodec(schema.item);
    case "option": {
      const inner = codec(schema.inner);
      return {
        read: (r) => (r.number() !== 0 ? inner.read(r) : null),
        write: (w, v) => {
          if (v != null) {
            w.number(1);
            inner.write(w, v);
          } else w.number(0);
        },
      };
    }
    case "names": {
      if (schema.emitted) return schema.emitted;
      const all = schema.names;
      return {
        read: (r) => {
          const name = all[r.count()];
          if (name === undefined) throw new Error("unknown variant");
          return name;
        },
        write: (w, v) => w.number(all.indexOf(v as string)),
      };
    }
    case "struct":
      if (schema.emitted) return schema.emitted;
      return structCodec(schema.fields, null, "");
    case "variant": {
      const caseNames = Object.keys(schema.cases);
      const tag = schema.tag;
      const bodies = caseNames.map((name) => {
        const body = schema.cases[name]!;
        if (body.kind !== "struct") throw new Error("variant cases are structs");
        return structCodec(body.fields, tag, name);
      });
      return {
        read: (r) => {
          const body = bodies[r.count()];
          if (body === undefined) throw new Error("unknown variant");
          return body.read(r);
        },
        write: (w, v) => {
          const index = caseNames.indexOf((v as Record<string, string>)[tag]!);
          w.number(index);
          bodies[index]!.write(w, v);
        },
      };
    }
  }
}

function listCodec(itemSchema: Schema): Codec {
  // Scalar items read without the per-item closure hop.
  if (itemSchema.kind === "number" || itemSchema.kind === "count") {
    const clamp = itemSchema.kind === "count";
    return {
      read: (r) => {
        const n = r.count();
        const items: number[] = [];
        for (let i = 0; i < n; i++) items.push(clamp ? r.count() : r.number());
        return items;
      },
      write: (w, v) => {
        const items = v as readonly number[];
        w.number(items.length);
        for (const item of items) w.number(item);
      },
    };
  }
  const item = codec(itemSchema);
  return {
    read: (r) => {
      const n = r.count();
      const items: unknown[] = [];
      for (let i = 0; i < n; i++) items.push(item.read(r));
      return items;
    },
    write: (w, v) => {
      const items = v as readonly unknown[];
      w.number(items.length);
      for (const value of items) item.write(w, value);
    },
  };
}

function structCodec(fields: Readonly<Record<string, Schema>>, tag: string | null, tagValue: string): Codec {
  const keys = Object.keys(fields);
  const parts = keys.map((key) => codec(fields[key]!));
  const n = keys.length;
  return {
    read: (r) => {
      const out: Record<string, unknown> = tag === null ? {} : { [tag]: tagValue };
      for (let i = 0; i < n; i++) out[keys[i]!] = parts[i]!.read(r);
      return out;
    },
    write: (w, v) => {
      const value = v as Record<string, unknown>;
      for (let i = 0; i < n; i++) parts[i]!.write(w, value[keys[i]!]);
    },
  };
}

/** Encodes `value` into the shared writer; the view is valid until the next encode. */
export function encode(schema: Schema, value: unknown): Float64Array {
  const w = Writer.shared();
  codec(schema).write(w, value);
  return w.finish();
}

export function decode(schema: Schema, values: Float64Array): unknown {
  return codec(schema).read(new Reader(values));
}

/** One module function: encode the input, call, decode the reply. */
export function call<I, O>(binding: (input: Float64Array) => Float64Array, input: Schema, output: Schema): (value: I) => O {
  const inC = codec(input);
  const outC = codec(output);
  return (value) => {
    const w = Writer.shared();
    inC.write(w, value);
    return outC.read(new Reader(binding(w.finish()))) as O;
  };
}
