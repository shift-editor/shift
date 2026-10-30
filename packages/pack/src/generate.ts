// Writes the TypeScript side of `crates/pack` from the fragments its macros
// write while they expand (see crates/pack-derive/src/fragments.rs).
//
// Each type becomes a schema (`struct`, `variants`) and its type (`Infer`),
// plus its own read and write functions, with every list read and written by
// a loop of its own: shared helpers cost up to 1.6x in V8 once many types use
// them (the phase c bench in the boundary protocol plan). Each interface
// becomes a class whose methods send their arguments by the method's index
// through a `SyncTransport`.
import { globSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { code, imp, joinCode, literalOf, type Code } from "ts-poet";

/** A field's, argument's or result's type, as the derive spells it. */
export type Type =
  | { readonly kind: "number" | "count" | "flag" | "name" }
  | { readonly kind: "list"; readonly item: Type }
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
export type Fragment = (StructFragment | EnumFragment | InterfaceFragment) & {
  readonly crate?: string;
};

type Declared = (StructFragment | EnumFragment) & { readonly crate?: string };

const pack = (name: string) => imp(`${name}@@shift/pack`);
const packType = (name: string) => imp(`t:${name}@@shift/pack`);
const Reader = packType("Reader");
const Writer = packType("Writer");
const SyncTransport = packType("SyncTransport");
const Infer = packType("Infer");
const SCALARS = new Set(["number", "count", "flag", "name"]);

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
  const ordered: Declared[] = [];
  const written = new Set<string>();
  const read = new Set<string>();
  const visit = (type: Type, user: string, direction: Set<string>): void => {
    if (type.kind === "list") return visit(type.item, user, direction);
    if (type.kind === "option") return visit(type.inner, user, direction);
    if (type.kind !== "ref") return;
    const found = resolve(type, user);
    if (direction.has(found.rust)) return;
    direction.add(found.rust);
    if (found.kind === "struct") {
      for (const field of found.fields) visit(field.type, found.rust, direction);
    }
    if (!ordered.includes(found)) ordered.push(found);
  };
  for (const item of interfaces) {
    for (const method of item.methods) {
      for (const param of method.params) visit(param.type, item.name, written);
      visit(method.output, item.name, read);
    }
  }

  /** The TypeScript type of `type`'s values. */
  const ts = (type: Type): string => {
    switch (type.kind) {
      case "number":
      case "count":
        return "number";
      case "flag":
        return "boolean";
      case "name":
        return "string";
      case "list":
        return `readonly ${element(ts(type.item))}[]`;
      case "option":
        return `${ts(type.inner)} | null`;
      case "ref":
        return resolve(type).name;
    }
  };

  /** `type` as a schema expression. */
  const schema = (type: Type): Code => {
    switch (type.kind) {
      case "list":
        return code`${pack("list")}(${schema(type.item)})`;
      case "option":
        return code`${pack("option")}(${schema(type.inner)})`;
      case "ref":
        return code`${resolve(type).name}`;
      default:
        return code`${pack(type.kind)}`;
    }
  };

  /** Statements that read `type` from `r` into a new `target`. */
  const readInto = (type: Type, target: string, depth = 0): Code => {
    if (SCALARS.has(type.kind)) return code`const ${target} = r.${type.kind}();`;
    switch (type.kind) {
      case "ref":
        return code`const ${target} = read${resolve(type).name}(r);`;
      case "list": {
        const [item, i, n] = [`item${depth}`, `i${depth}`, `n${depth}`];
        return code`
          const ${target}: ${element(ts(type.item))}[] = [];
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
      case "ref":
        return code`write${resolve(type).name}(w, ${value});`;
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

  const structSchema = (type: StructFragment): Code => {
    const fields = type.fields.map(
      (field) => code`${doc(field.doc)}${field.name}: ${schema(field.type)},`,
    );
    return code`${pack("struct")}({ ${joinCode(fields, { on: "\n" })} })`;
  };

  const schemaOf = (type: Declared): Code => {
    if (type.kind === "enum") return enumSchema(type);
    return structSchema(type);
  };

  const declaration = (type: Declared): Code => {
    const value = schemaOf(type);
    return code`
      ${doc(type.doc)}export const ${type.name} = ${value};
      export type ${type.name} = ${Infer}<typeof ${type.name}>;
    `;
  };

  const method = (item: Method, index: number): Code => {
    const params = item.params.map((param) => `${param.name}: ${ts(param.type)}`).join(", ");
    const writes = item.params.map((param) => writeFrom(param.type, param.name));
    return code`
      ${doc(item.doc)}${item.name}(${params}): ${ts(item.output)} {
        const w = this.#transport.writer();
        ${joinCode(writes, { on: "\n" })}
        const r = this.#transport.request(${index}, w);
        ${readInto(item.output, "result")}
        return result;
      }
    `;
  };

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

  const readStruct = (type: StructFragment): Code => {
    const reads = type.fields.map((field, index) => readInto(field.type, `field${index}`));
    const fields = type.fields.map((field, index) => code`${field.name}: field${index},`);
    return code`
      function read${type.name}(r: ${Reader}): ${type.name} {
        ${joinCode(reads, { on: "\n" })}
        return { ${joinCode(fields, { on: "\n" })} };
      }
    `;
  };

  const writeEnum = (type: EnumFragment): Code => code`
    function write${type.name}(w: ${Writer}, value: ${type.name}): void {
      w.count(${type.name}.names.indexOf(value));
    }
  `;

  const writeStruct = (type: StructFragment): Code => {
    const writes = type.fields.map((field) => writeFrom(field.type, `value.${field.name}`));
    return code`
      function write${type.name}(w: ${Writer}, value: ${type.name}): void {
        ${joinCode(writes, { on: "\n" })}
      }
    `;
  };

  const reader = (type: Declared): Code => {
    if (type.kind === "enum") return readEnum(type);
    return readStruct(type);
  };

  const writer = (type: Declared): Code => {
    if (type.kind === "enum") return writeEnum(type);
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

/** Parenthesises a union or a readonly array so it can take `[]`. */
function element(type: string): string {
  return type.includes("|") || type.startsWith("readonly ") ? `(${type})` : type;
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
