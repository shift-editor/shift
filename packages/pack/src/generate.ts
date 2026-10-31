// Writes the TypeScript side of `crates/pack` from the fragments its macros
// write while they expand (see crates/pack-derive/src/fragments.rs).
//
// Each type becomes its type, spelled out as an interface or a union so
// editors and declaration bundles show it by name, its schema (`struct`,
// `variants`) as `<Name>Schema`, whose `Infer` is the same type, and its own
// read and write functions, with every list read and written by
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
  /** Nothing: only as a method's result, or a `Result`'s value. */
  | { readonly kind: "unit" }
  | { readonly kind: "list"; readonly item: Type }
  /** Read as a `Record`: its key is a name or an id. */
  | { readonly kind: "map"; readonly key: Type; readonly value: Type }
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

/** A struct of one field, which crosses as that field and reads as its type. */
interface AliasFragment {
  readonly kind: "alias";
  readonly rust: string;
  readonly name: string;
  readonly doc: string | null;
  readonly type: Type;
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
  | AliasFragment
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
const Schema = packType("Schema");
const PackError = pack("PackError");
const SCALARS = new Set(["number", "count", "flag", "name", "numbers", "bytes"]);

/** Thrown for a `Result` anywhere but as a method's result, which TypeScript has no shape for. */
function nestedResult(): never {
  throw new Error("a Result crosses only as an interface method's result");
}

/** Thrown for `()` anywhere but as a method's result or a `Result`'s value. */
function nestedUnit(): never {
  throw new Error("() crosses only as an interface method's result");
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

/** How {@link render} writes the module. */
export interface RenderOptions {
  /**
   * Where to import each id brand's module from instead, by the module an
   * id names: for a module generated inside the package that declares the
   * brands, which cannot import itself by name.
   */
  readonly brandModules?: Readonly<Record<string, string>>;
  /** Render only the interfaces these packages declare, and the types they use; all by default. */
  // oxlint-disable-next-line shift/no-optional-collection-field -- absent renders every package's interfaces, which an empty list would not
  readonly crates?: readonly string[];
}

/** Writes the module `render` returns for the fragments under `folder` to `output`. */
export function generate(
  folder: string,
  output: string,
  header = "",
  options: RenderOptions = {},
): void {
  const text = render(readFragments(folder), header, options);
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
export function render(
  described: readonly Fragment[],
  header = "",
  options: RenderOptions = {},
): string {
  const fragments = withCrateNames(withoutAliases(described));
  const types = new Map<string, Declared>();
  for (const fragment of fragments) {
    if (fragment.kind === "interface") continue;
    const existing = types.get(fragment.rust);
    if (existing && shapeOf(existing) !== shapeOf(fragment)) {
      throw new Error(
        `two types are named ${fragment.rust} (in ${existing.crate} and ${fragment.crate})`,
      );
    }
    types.set(fragment.rust, fragment);
  }
  const interfaces = fragments
    .filter(
      (fragment): fragment is InterfaceFragment & { readonly crate?: string } =>
        fragment.kind === "interface",
    )
    .filter((item) => !options.crates || options.crates.includes(item.crate ?? ""))
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
    if (type.kind === "map") {
      visit(type.key, user, direction);
      return visit(type.value, user, direction);
    }
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
      if (field.type.kind === "unit") nestedUnit();
      visit(field.type, found.rust, direction);
    }
    if (!ordered.includes(found)) ordered.push(found);
  };
  for (const item of interfaces) {
    for (const method of item.methods) {
      for (const param of method.params) {
        if (param.type.kind === "result") nestedResult();
        if (param.type.kind === "unit") nestedUnit();
        visit(param.type, item.name, written);
      }
      visit(method.output, item.name, read);
    }
  }

  /** An id's brand, imported from the module that declares it. */
  const brand = (type: IdFragment): Code => {
    const module = options.brandModules?.[type.module] ?? type.module;
    return code`${imp(`t:${type.name}@${module}`)}`;
  };

  /** A map's key type, which a `Record` takes: a name or an id. */
  const key = (type: Type): Code => {
    if (type.kind === "name") return code`string`;
    if (type.kind === "ref") {
      const found = resolve(type);
      if (found.kind === "id") return brand(found);
    }
    throw new Error("a map's key is a name or an id");
  };

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
      case "map":
        return code`Readonly<Record<${key(type.key)}, ${ts(type.value)}>>`;
      case "unit":
        return code`void`;
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
      case "map":
        return code`${pack("map")}(${schema(type.key)}, ${schema(type.value)})`;
      case "unit":
        return nestedUnit();
      case "ref": {
        const found = resolve(type);
        return found.kind === "id"
          ? code`${pack("id")}<${brand(found)}>()`
          : code`${schemaName(found)}`;
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
      case "map": {
        const [k, v, i, n] = [`key${depth}`, `value${depth}`, `i${depth}`, `n${depth}`];
        return code`
          const ${target}: Record<${key(type.key)}, ${ts(type.value)}> = {};
          for (let ${i} = 0, ${n} = r.count(); ${i} < ${n}; ${i}++) {
            ${readInto(type.key, k, depth + 1)}
            ${readInto(type.value, v, depth + 1)}
            ${target}[${k}] = ${v};
          }
        `;
      }
      case "unit":
        return code``;
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
      case "map": {
        const [entries, k, v] = [`entries${depth}`, `key${depth}`, `value${depth}`];
        return code`
          const ${entries} = Object.entries(${value}) as [${key(type.key)}, ${ts(type.value)}][];
          w.count(${entries}.length);
          for (const [${k}, ${v}] of ${entries}) {
            ${writeFrom(type.key, k, depth + 1)}
            ${writeFrom(type.value, v, depth + 1)}
          }
        `;
      }
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

  /** A struct's or a case's fields as an object type's members, an option left out as `null` or absent. */
  const members = (fields: readonly Field[]): Code =>
    joinCode(
      fields.map(
        (field) =>
          code`${doc(field.doc)}readonly ${field.name}${field.type.kind === "option" ? "?" : ""}: ${ts(field.type)};`,
      ),
      { on: "\n" },
    );

  /** The type of `type`'s values, spelled out, so editors and declaration bundles show it by name. */
  const typeOf = (type: Generated): Code => {
    if (type.kind === "enum") {
      return joinCode(
        type.variants.map((variant) => code`${literalOf(variant)}`),
        { on: " | " },
      );
    }
    if (type.kind === "union") {
      const cases = type.cases.map(
        (item) =>
          code`${doc(item.doc)}| { readonly kind: ${literalOf(item.name)}; ${members(item.fields)} }`,
      );
      return joinCode(cases, { on: "\n" });
    }
    return code`{ ${members(type.fields)} }`;
  };

  const declaration = (type: Generated): Code => {
    const value = schemaOf(type);
    const declared =
      type.kind === "struct"
        ? code`export interface ${type.name} ${typeOf(type)}`
        : code`export type ${type.name} =\n${typeOf(type)};`;
    return code`
      ${doc(type.doc)}${declared}
      /** {@link ${type.name}}'s schema: its shape, as the packed encoding reads it. */
      export const ${schemaName(type)} = ${value} satisfies ${Schema};
    `;
  };

  const method = (item: Method, index: number): Code => {
    // Trailing optional arguments may be left out, as `undefined` writes as absent.
    const required = item.params.findLastIndex((param) => param.type.kind !== "option") + 1;
    const params = joinCode(
      item.params.map(
        (param, at) => code`${param.name}${at < required ? "" : "?"}: ${ts(param.type)}`,
      ),
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
          ${returned(output.ok)}
        }
      `;
    }
    return code`
      ${doc(item.doc)}${item.name}(${params}): ${ts(output)} {
        const w = this.#transport.writer();
        ${joinCode(writes, { on: "\n" })}
        ${output.kind === "unit" ? code`this.#transport.request(${index}, w);` : code`const r = this.#transport.request(${index}, w);`}
        ${returned(output)}
      }
    `;
  };

  /** Statements that read a method's result of `type` and return it; none for a unit. */
  const returned = (type: Type): Code =>
    type.kind === "unit"
      ? code``
      : code`
          ${readInto(type, "result")}
          return result;
        `;

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
        const value = ${schemaName(type)}.names[r.count()];
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
      w.count(${schemaName(type)}.names.indexOf(value));
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
    const unknown = `unknown ${type.name} kind `;
    return code`
      function write${type.name}(w: ${Writer}, value: ${type.name}): void {
        switch (value.kind) {
          ${joinCode(cases, { on: "\n" })}
          default:
            throw new Error(${literalOf(unknown)} + String((value as { kind: unknown }).kind));
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

  const named = new Map<string, string>();
  for (const type of ordered) {
    const other = named.get(type.name);
    if (other !== undefined && other !== type.rust) {
      throw new Error(
        `two types are called ${type.name} in TypeScript (${other} and ${type.rust})`,
      );
    }
    named.set(type.name, type.rust);
  }

  const codecs: Code[] = [];
  for (const type of ordered) {
    if (read.has(type.rust)) codecs.push(reader(type));
    if (written.has(type.rust)) codecs.push(writer(type));
  }
  const declarations = [...ordered.map(declaration), ...interfaces.map(klass)];
  return joinCode([...declarations, ...codecs], { on: "\n\n" }).toString({ prefix: header });
}

/** The name a type's schema is exported under, beside the type itself. */
function schemaName(type: { readonly name: string }): string {
  return `${type.name}Schema`;
}

type Unaliased = Exclude<Fragment, AliasFragment>;

/** `type` with every type it holds that holds none, however deep, passed through `map`. */
function mapType(type: Type, map: (type: Type) => Type): Type {
  switch (type.kind) {
    case "list":
      return { ...type, item: mapType(type.item, map) };
    case "option":
      return { ...type, inner: mapType(type.inner, map) };
    case "map":
      return { ...type, key: mapType(type.key, map), value: mapType(type.value, map) };
    case "result":
      return { ...type, ok: mapType(type.ok, map), err: mapType(type.err, map) };
    default:
      return map(type);
  }
}

/** `fragment` with every type it names passed through `map`, as {@link mapType} does. */
function mapTypes(fragment: Unaliased, map: (type: Type) => Type): Unaliased {
  const each = (type: Type): Type => mapType(type, map);
  const fields = (list: readonly Field[]): Field[] =>
    list.map((field) => ({ ...field, type: each(field.type) }));
  switch (fragment.kind) {
    case "struct":
      return { ...fragment, fields: fields(fragment.fields) };
    case "union":
      return {
        ...fragment,
        cases: fragment.cases.map((item) => ({ ...item, fields: fields(item.fields) })),
      };
    case "interface":
      return {
        ...fragment,
        methods: fragment.methods.map((method) => ({
          ...method,
          params: method.params.map((param) => ({ ...param, type: each(param.type) })),
          output: each(method.output),
        })),
      };
    default:
      return fragment;
  }
}

/**
 * `fragments` without their aliases, each type that names an alias naming the
 * alias's field type instead: an alias crosses as its field, so TypeScript
 * reads it as that type.
 */
function withoutAliases(fragments: readonly Fragment[]): Unaliased[] {
  const aliases = new Map<string, Type>();
  for (const fragment of fragments) {
    if (fragment.kind === "alias") aliases.set(fragment.rust, fragment.type);
  }
  const unaliased = (type: Type): Type => {
    const alias = type.kind === "ref" ? aliases.get(type.rust) : undefined;
    return alias ? mapType(alias, unaliased) : type;
  };
  return fragments
    .filter((fragment): fragment is Unaliased => fragment.kind !== "alias")
    .map((fragment) => mapTypes(fragment, unaliased));
}

/**
 * `fragments` with each Rust name that two crates give different types
 * qualified by its crate (`shift-font::Axis`) wherever that crate declares
 * or names it. The one of them TypeScript calls by its Rust name keeps it,
 * and is the one other crates name; the rest need a `#[pack(rename)]`.
 *
 * @throws When two crates' types under one Rust name both keep that name.
 */
function withCrateNames(fragments: readonly Unaliased[]): Unaliased[] {
  const declared = new Map<string, Declared[]>();
  for (const fragment of fragments) {
    if (fragment.kind === "interface") continue;
    declared.set(fragment.rust, [...(declared.get(fragment.rust) ?? []), fragment]);
  }
  // Rust name → the crates whose own type under it is qualified.
  const qualified = new Map<string, Set<string>>();
  for (const [rust, declarations] of declared) {
    const shapes = new Set(declarations.map(shapeOf));
    if (shapes.size < 2) continue;
    const keeping = declarations.filter((fragment) => fragment.name === rust);
    if (new Set(keeping.map(shapeOf)).size !== 1) {
      const [first, second] = declarations;
      throw new Error(`two types are named ${rust} (in ${first!.crate} and ${second!.crate})`);
    }
    const kept = shapeOf(keeping[0]!);
    qualified.set(
      rust,
      new Set(
        declarations.filter((fragment) => shapeOf(fragment) !== kept).map((f) => f.crate ?? ""),
      ),
    );
  }
  if (qualified.size === 0) return [...fragments];
  return fragments.map((fragment) => {
    const crate = fragment.crate ?? "";
    const own = (rust: string) => qualified.get(rust)?.has(crate) ?? false;
    const renamed = mapTypes(fragment, (type) =>
      type.kind === "ref" && own(type.rust) ? { ...type, rust: `${crate}::${type.rust}` } : type,
    );
    return renamed.kind !== "interface" && own(renamed.rust)
      ? { ...renamed, rust: `${crate}::${renamed.rust}` }
      : renamed;
  });
}

/** Orders items by their TypeScript name. */
function byName(a: { readonly name: string }, b: { readonly name: string }): number {
  return a.name.localeCompare(b.name);
}

/**
 * What TypeScript sees of a declaration, for comparing two: everything but
 * where it came from and its docs. Two crates may each declare a type under
 * one Rust name, as a wire type and its domain type do, while their shapes
 * agree; the first one's docs are kept.
 */
function shapeOf({ crate: _crate, ...fragment }: Declared): string {
  return JSON.stringify(fragment, (key, value: unknown) => (key === "doc" ? undefined : value));
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
