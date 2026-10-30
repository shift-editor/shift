// Writes the TypeScript side of `crates/pack` from the fragments its macros
// write while they expand (see crates/pack-derive/src/fragments.rs).
//
// Each type becomes a schema (`struct`, `variants`) and its type (`Infer`),
// plus its own read and write functions, with every list read and written by
// a loop of its own: shared helpers cost up to 1.6x in V8 once many types use
// them (the phase c bench in the boundary protocol plan). Each interface
// becomes a class whose methods send their arguments by the method's index
// through a `SyncTransport`; a method whose Rust result is `Result<T, E>`
// returns `T` and throws a `PackError` carrying `E`.
import { globSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { code, imp, joinCode, literalOf, type Code } from "ts-poet";

/** A field's, argument's or result's type, as the derive spells it. */
export type Type =
  | { readonly kind: "number" | "count" | "flag" | "name" | "numbers" | "bytes" }
  | { readonly kind: "list"; readonly item: Type }
  /** Only as a method's result. */
  | { readonly kind: "result"; readonly ok: Type; readonly err: Type }
  | { readonly kind: "option"; readonly inner: Type }
  | { readonly kind: "ref"; readonly rust: string };

interface Field {
  readonly name: string;
  readonly doc: string | null;
  readonly type: Type;
}

interface StructFragment {
  readonly kind: "struct";
  readonly rust: string;
  readonly name: string;
  readonly doc: string | null;
  readonly fields: readonly Field[];
}

interface EnumFragment {
  readonly kind: "enum";
  readonly rust: string;
  readonly name: string;
  readonly doc: string | null;
  readonly variants: readonly string[];
}

interface IdFragment {
  readonly kind: "id";
  readonly rust: string;
  readonly name: string;
  readonly doc: string | null;
  /** The module that declares the id's brand. */
  readonly module: string;
}

interface Case {
  readonly name: string;
  readonly doc: string | null;
  readonly fields: readonly Field[];
}

interface UnionFragment {
  readonly kind: "union";
  readonly rust: string;
  readonly name: string;
  readonly doc: string | null;
  readonly cases: readonly Case[];
}

interface Method {
  readonly name: string;
  readonly doc: string | null;
  readonly params: readonly { readonly name: string; readonly type: Type }[];
  readonly output: Type;
}

interface InterfaceFragment {
  readonly kind: "interface";
  readonly rust: string;
  readonly name: string;
  readonly doc: string | null;
  readonly methods: readonly Method[];
}

/** One item's description, as `#[derive(Pack)]` or `#[pack::interface]` writes it, and the package it came from. */
export type Fragment = (
  | StructFragment
  | EnumFragment
  | UnionFragment
  | IdFragment
  | InterfaceFragment
) & {
  readonly crate?: string;
};

type Declared = (StructFragment | EnumFragment | UnionFragment | IdFragment) & {
  readonly crate?: string;
};
/** A type this module declares, with a schema, a reader and a writer; ids are imported instead. */
type Generated = Exclude<Declared, IdFragment>;

const pack = (name: string) => imp(`${name}@@shift/pack`);
const packType = (name: string) => imp(`t:${name}@@shift/pack`);
const Reader = packType("Reader");
const Writer = packType("Writer");
const SyncTransport = packType("SyncTransport");
const Infer = packType("Infer");
const PackError = pack("PackError");
const SCALARS = new Set(["number", "count", "flag", "name", "numbers", "bytes"]);

/** Thrown for a `Result` anywhere but as a method's result, which TypeScript has no shape for. */
function nestedResult(): never {
  throw new Error("a Result crosses only as an interface method's result");
}

/** Reads every crate's fragments under `folder` (`<folder>/<package>/*.json`). */
export function readFragments(folder: string): Fragment[] {
  return globSync("*/*.json", { cwd: folder })
    .sort()
    .map((file) => ({
      ...JSON.parse(readFileSync(join(folder, file), "utf8")),
      crate: dirname(file),
    }));
}

/** Writes the module `render` returns for the fragments under `folder` to `output`. */
export function generate(folder: string, output: string, header = ""): void {
  const text = render(readFragments(folder), header);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, text);
}

/**
 * The TypeScript module for `fragments`: every interface's class and every
 * type they use.
 *
 * @throws When an interface uses a type no fragment declares, or two crates
 * declare different types under one Rust name.
 */
export function render(fragments: readonly Fragment[], header = ""): string {
  const types = new Map<string, Declared>();
  for (const fragment of fragments) {
    if (fragment.kind === "interface") continue;
    const existing = types.get(fragment.rust);
    if (
      existing &&
      JSON.stringify(withoutCrate(existing)) !== JSON.stringify(withoutCrate(fragment))
    ) {
      throw new Error(
        `two types are named ${fragment.rust} (in ${existing.crate} and ${fragment.crate})`,
      );
    }
    types.set(fragment.rust, fragment);
  }
  const interfaces = fragments
    .filter((fragment): fragment is InterfaceFragment => fragment.kind === "interface")
    .sort(byName);

  const resolve = (type: Extract<Type, { kind: "ref" }>, user?: string): Declared => {
    const found = types.get(type.rust);
    if (!found) throw new Error(`${user} uses ${type.rust}, which has no #[derive(Pack)]`);
    return found;
  };

  // Every type the interfaces use, each after the types it uses, so a schema
  // is declared before another schema names it. Types that cross as
  // arguments get a writer and types that cross as results a reader.
  const ordered: Generated[] = [];
  const written = new Set<string>();
  const read = new Set<string>();
  const visit = (type: Type, user: string, direction: Set<string>): void => {
    if (type.kind === "list") return visit(type.item, user, direction);
    if (type.kind === "option") return visit(type.inner, user, direction);
    if (type.kind === "result") {
      visit(type.ok, user, direction);
      return visit(type.err, user, direction);
    }
    if (type.kind !== "ref") return;
    const found = resolve(type, user);
    if (found.kind === "id" || direction.has(found.rust)) return;
    direction.add(found.rust);
    for (const field of fieldsOf(found)) {
      if (field.type.kind === "result") nestedResult();
      visit(field.type, found.rust, direction);
    }
    if (!ordered.includes(found)) ordered.push(found);
  };
  for (const item of interfaces) {
    for (const method of item.methods) {
      for (const param of method.params) {
        if (param.type.kind === "result") nestedResult();
        visit(param.type, item.name, written);
      }
      visit(method.output, item.name, read);
    }
  }

  /** An id's brand, imported from the module that declares it. */
  const brand = (type: IdFragment): Code => code`${imp(`t:${type.name}@${type.module}`)}`;

  /** The TypeScript type of `type`'s values. */
  const ts = (type: Type): Code => {
    switch (type.kind) {
      case "number":
      case "count":
        return code`number`;
      case "flag":
        return code`boolean`;
      case "name":
        return code`string`;
      case "numbers":
        return code`Float64Array`;
      case "bytes":
        return code`Uint8Array`;
      case "list":
        return code`readonly ${element(type.item)}[]`;
      case "option":
        return code`${ts(type.inner)} | null`;
      case "ref": {
        const found = resolve(type);
        return found.kind === "id" ? brand(found) : code`${found.name}`;
      }
      case "result":
        return nestedResult();
    }
  };

  /** `type` as an array's element type, parenthesised when it is a union or an array. */
  const element = (type: Type): Code =>
    type.kind === "option" || type.kind === "list" ? code`(${ts(type)})` : ts(type);

  /** `type` as a schema expression. */
  const schema = (type: Type): Code => {
    switch (type.kind) {
      case "list":
        return code`${pack("list")}(${schema(type.item)})`;
      case "option":
        return code`${pack("option")}(${schema(type.inner)})`;
      case "ref": {
        const found = resolve(type);
        return found.kind === "id" ? code`${pack("id")}<${brand(found)}>()` : code`${found.name}`;
      }
      case "result":
        return nestedResult();
      default:
        return code`${pack(type.kind)}`;
    }
  };

  /** Statements that read `type` from `r` into a new `target`. */
  const readInto = (type: Type, target: string, depth = 0): Code => {
    if (SCALARS.has(type.kind)) return code`const ${target} = r.${type.kind}();`;
    switch (type.kind) {
      case "ref": {
        const found = resolve(type);
        if (found.kind === "id") return code`const ${target} = r.name() as ${brand(found)};`;
        return code`const ${target} = read${found.name}(r);`;
      }
      case "list": {
        const [item, i, n] = [`item${depth}`, `i${depth}`, `n${depth}`];
        return code`
          const ${target}: ${element(type.item)}[] = [];
          for (let ${i} = 0, ${n} = r.count(); ${i} < ${n}; ${i}++) {
            ${readInto(type.item, item, depth + 1)}
            ${target}.push(${item});
          }
        `;
      }
      case "option": {
        const some = `some${depth}`;
        return code`
          let ${target}: ${ts(type)} = null;
          if (r.flag()) {
            ${readInto(type.inner, some, depth + 1)}
            ${target} = ${some};
          }
        `;
      }
    }
    throw new Error(`unknown type ${type.kind}`);
  };

  /** Statements that write `value`, an expression of `type`, to `w`. */
  const writeFrom = (type: Type, value: string, depth = 0): Code => {
    if (SCALARS.has(type.kind)) return code`w.${type.kind}(${value});`;
    switch (type.kind) {
      case "ref": {
        const found = resolve(type);
        if (found.kind === "id") return code`w.name(${value});`;
        return code`write${found.name}(w, ${value});`;
      }
      case "list": {
        const item = `item${depth}`;
        return code`
          w.count(${value}.length);
          for (const ${item} of ${value}) {
            ${writeFrom(type.item, item, depth + 1)}
          }
        `;
      }
      case "option":
        return code`
          if (${value} != null) {
            w.flag(true);
            ${writeFrom(type.inner, value, depth + 1)}
          } else {
            w.flag(false);
          }
        `;
    }
    throw new Error(`unknown type ${type.kind}`);
  };

  const enumSchema = (type: EnumFragment): Code => {
    const names = type.variants.map((variant) => code`${literalOf(variant)}`);
    return code`${pack("variants")}(${joinCode(names, { on: ", " })})`;
  };

  const fieldsSchema = (fields: readonly Field[]): Code => {
    const entries = fields.map(
      (field) => code`${doc(field.doc)}${field.name}: ${schema(field.type)},`,
    );
    return code`${pack("struct")}({ ${joinCode(entries, { on: "\n" })} })`;
  };

  const unionSchema = (type: UnionFragment): Code => {
    const cases = type.cases.map(
      (item) => code`${doc(item.doc)}${item.name}: ${fieldsSchema(item.fields)},`,
    );
    return code`${pack("union")}({ ${joinCode(cases, { on: "\n" })} })`;
  };

  const schemaOf = (type: Generated): Code => {
    if (type.kind === "enum") return enumSchema(type);
    if (type.kind === "union") return unionSchema(type);
    return fieldsSchema(type.fields);
  };

  const declaration = (type: Generated): Code => {
    const value = schemaOf(type);
    return code`
      ${doc(type.doc)}export const ${type.name} = ${value};
      export type ${type.name} = ${Infer}<typeof ${type.name}>;
    `;
  };

  const method = (item: Method, index: number): Code => {
    const params = joinCode(
      item.params.map((param) => code`${param.name}: ${ts(param.type)}`),
      { on: ", " },
    );
    const writes = item.params.map((param) => writeFrom(param.type, param.name));
    const output = item.output;
    if (output.kind === "result") {
      const thrown = `@throws {@link PackError} carrying a ${errorName(output.err)} when Rust returns an error.`;
      return code`
        ${doc([withoutErrors(item.doc), thrown].filter(Boolean).join("\n\n"))}${item.name}(${params}): ${ts(output.ok)} {
          const w = this.#transport.writer();
          ${joinCode(writes, { on: "\n" })}
          const r = this.#transport.request(${index}, w);
          if (!r.flag()) {
            ${readInto(output.err, "error")}
            throw new ${PackError}<${ts(output.err)}>(${literalOf(errorName(output.err))}, error);
          }
          ${readInto(output.ok, "result")}
          return result;
        }
      `;
    }
    return code`
      ${doc(item.doc)}${item.name}(${params}): ${ts(output)} {
        const w = this.#transport.writer();
        ${joinCode(writes, { on: "\n" })}
        const r = this.#transport.request(${index}, w);
        ${readInto(output, "result")}
        return result;
      }
    `;
  };

  /** The TypeScript name of an error type, as a thrown `PackError`'s `type`. */
  const errorName = (type: Type): string => (type.kind === "ref" ? resolve(type).name : type.kind);

  const klass = (item: InterfaceFragment): Code => code`
    ${doc(item.doc)}export class ${item.name} {
      readonly #transport: ${SyncTransport};

      constructor(transport: ${SyncTransport}) {
        this.#transport = transport;
      }

      ${joinCode(item.methods.map(method), { on: "\n\n" })}
    }
  `;

  const readEnum = (type: EnumFragment): Code => {
    const unknown = `unknown ${type.name}, from a module built with another ${type.name}`;
    return code`
      function read${type.name}(r: ${Reader}): ${type.name} {
        const value = ${type.name}.names[r.count()];
        if (value === undefined) throw new Error(${literalOf(unknown)});
        return value;
      }
    `;
  };

  /** Statements reading `fields` in order, then returning them with `head` first. */
  const readFields = (fields: readonly Field[], head: Code | string = ""): Code => {
    const reads = fields.map((field, index) => readInto(field.type, `field${index}`));
    const entries = fields.map((field, index) => code`${field.name}: field${index},`);
    return code`
      ${joinCode(reads, { on: "\n" })}
      return { ${head}${joinCode(entries, { on: "\n" })} };
    `;
  };

  const readStruct = (type: StructFragment): Code => code`
    function read${type.name}(r: ${Reader}): ${type.name} {
      ${readFields(type.fields)}
    }
  `;

  const readUnion = (type: UnionFragment): Code => {
    const unknown = `unknown ${type.name}, from a module built with another ${type.name}`;
    const cases = type.cases.map(
      (item, index) => code`
        case ${index}: {
          ${readFields(item.fields, code`kind: ${literalOf(item.name)}, `)}
        }
      `,
    );
    return code`
      function read${type.name}(r: ${Reader}): ${type.name} {
        switch (r.count()) {
          ${joinCode(cases, { on: "\n" })}
          default:
            throw new Error(${literalOf(unknown)});
        }
      }
    `;
  };

  const writeEnum = (type: EnumFragment): Code => code`
    function write${type.name}(w: ${Writer}, value: ${type.name}): void {
      w.count(${type.name}.names.indexOf(value));
    }
  `;

  /** Statements writing `fields` of `value` in order. */
  const writeFields = (fields: readonly Field[]): Code =>
    joinCode(
      fields.map((field) => writeFrom(field.type, `value.${field.name}`)),
      { on: "\n" },
    );

  const writeStruct = (type: StructFragment): Code => code`
    function write${type.name}(w: ${Writer}, value: ${type.name}): void {
      ${writeFields(type.fields)}
    }
  `;

  const writeUnion = (type: UnionFragment): Code => {
    const cases = type.cases.map(
      (item, index) => code`
        case ${literalOf(item.name)}:
          w.count(${index});
          ${writeFields(item.fields)}
          break;
      `,
    );
    return code`
      function write${type.name}(w: ${Writer}, value: ${type.name}): void {
        switch (value.kind) {
          ${joinCode(cases, { on: "\n" })}
        }
      }
    `;
  };

  const reader = (type: Generated): Code => {
    if (type.kind === "enum") return readEnum(type);
    if (type.kind === "union") return readUnion(type);
    return readStruct(type);
  };

  const writer = (type: Generated): Code => {
    if (type.kind === "enum") return writeEnum(type);
    if (type.kind === "union") return writeUnion(type);
    return writeStruct(type);
  };

  const codecs: Code[] = [];
  for (const type of ordered) {
    if (read.has(type.rust)) codecs.push(reader(type));
    if (written.has(type.rust)) codecs.push(writer(type));
  }
  const declarations = [...ordered.map(declaration), ...interfaces.map(klass)];
  return joinCode([...declarations, ...codecs], { on: "\n\n" }).toString({ prefix: header });
}

/** Orders items by their TypeScript name. */
function byName(a: { readonly name: string }, b: { readonly name: string }): number {
  return a.name.localeCompare(b.name);
}

/** A fragment without where it came from, for comparing two declarations. */
function withoutCrate({ crate: _crate, ...fragment }: Declared): object {
  return fragment;
}

/** The fields a type's values carry: a struct's, or every case's of a union. */
function fieldsOf(type: Generated): readonly Field[] {
  if (type.kind === "struct") return type.fields;
  if (type.kind === "union") return type.cases.flatMap((item) => item.fields);
  return [];
}

/** Rust doc text without its `# Errors` section, which a `@throws` tag replaces. */
function withoutErrors(text: string | null): string | null {
  return text?.split(/^# Errors$/m)[0]!.trimEnd() || null;
}

/** A doc comment for an item, followed by a line break; empty without one. */
function doc(text: string | null): string {
  const lines = (text ?? "")
    .replaceAll("*/", "*\\/")
    .split("\n")
    .map((line) => line.trim());
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  if (lines.length === 0) return "";
  if (lines.length === 1) return `/** ${lines[0]} */\n`;
  return `/**\n${lines.map((line) => (line === "" ? " *" : ` * ${line}`)).join("\n")}\n */\n`;
}
