// Writes the TypeScript side of `crates/pack` from the fragments its macros
// write while they expand (see crates/pack-derive/src/fragments.rs).
//
// Each type becomes a schema (`struct`, `variants`) and its type (`Infer`),
// plus its own read and write functions, with every list read and written by
// a loop of its own: shared helpers cost up to 5x in V8 once many types use
// them (the phase c bench in the boundary protocol plan). Each interface
// becomes a class whose methods send their arguments by the method's index
// through a `SyncTransport`.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/** Reads every crate's fragments under `folder` (`<folder>/<package>/*.json`). */
export function readFragments(folder) {
  const fragments = [];
  for (const crate of readdirSync(folder, { withFileTypes: true })) {
    if (!crate.isDirectory()) continue;
    for (const file of readdirSync(join(folder, crate.name)).sort()) {
      if (!file.endsWith(".json")) continue;
      const fragment = JSON.parse(readFileSync(join(folder, crate.name, file), "utf8"));
      fragments.push({ ...fragment, crate: crate.name });
    }
  }
  return fragments;
}

/** Writes the module `render` returns for the fragments under `folder` to `output`. */
export function generate(folder, output, header) {
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
export function render(fragments, header = "") {
  const types = new Map();
  for (const fragment of fragments) {
    if (fragment.kind === "interface") continue;
    const existing = types.get(fragment.rust);
    if (existing && JSON.stringify(strip(existing)) !== JSON.stringify(strip(fragment))) {
      throw new Error(
        `two types are named ${fragment.rust} (in ${existing.crate} and ${fragment.crate})`,
      );
    }
    types.set(fragment.rust, fragment);
  }
  const interfaces = fragments.filter((fragment) => fragment.kind === "interface").sort(byName);

  const resolve = (type, user) => {
    const found = types.get(type.rust);
    if (!found) throw new Error(`${user} uses ${type.rust}, which has no #[derive(Pack)]`);
    return found;
  };

  // Every type the interfaces use, each after the types it uses, so a
  // schema is declared before another schema names it. Types that cross as
  // arguments get a writer and types that cross as results a reader.
  const ordered = [];
  const seen = new Set();
  const written = new Set();
  const read = new Set();
  const visit = (type, user, direction) => {
    if (type.kind === "list") return visit(type.item, user, direction);
    if (type.kind === "option") return visit(type.inner, user, direction);
    if (type.kind !== "ref") return;
    const found = resolve(type, user);
    if (direction.has(found.rust)) return;
    direction.add(found.rust);
    if (found.kind === "struct") {
      for (const field of found.fields) visit(field.type, found.rust, direction);
    }
    if (seen.has(found.rust)) return;
    seen.add(found.rust);
    ordered.push(found);
  };
  for (const item of interfaces) {
    for (const method of item.methods) {
      for (const param of method.params) visit(param.type, item.name, written);
      visit(method.output, item.name, read);
    }
  }

  const ts = (type) => {
    switch (type.kind) {
      case "number":
      case "count":
        return "number";
      case "flag":
        return "boolean";
      case "name":
        return "string";
      case "list":
        return `readonly ${wrap(ts(type.item))}[]`;
      case "option":
        return `${ts(type.inner)} | null`;
      case "ref":
        return resolve(type).name;
    }
    throw new Error(`unknown type ${type.kind}`);
  };
  const schema = (type) => {
    switch (type.kind) {
      case "number":
      case "count":
      case "flag":
      case "name":
        used.add(type.kind);
        return type.kind;
      case "list":
        used.add("list");
        return `list(${schema(type.item)})`;
      case "option":
        used.add("option");
        return `option(${schema(type.inner)})`;
      case "ref":
        return resolve(type).name;
    }
    throw new Error(`unknown type ${type.kind}`);
  };

  // Statements that read `type` into a new `const target`.
  const readInto = (type, target, depth, indent) => {
    switch (type.kind) {
      case "number":
      case "count":
      case "flag":
      case "name":
        return [`${indent}const ${target} = r.${type.kind}();`];
      case "ref":
        return [`${indent}const ${target} = read${resolve(type).name}(r);`];
      case "list": {
        const item = `item${depth}`;
        return [
          `${indent}const ${target}: ${wrap(ts(type.item))}[] = [];`,
          `${indent}for (let i${depth} = 0, n${depth} = r.count(); i${depth} < n${depth}; i${depth}++) {`,
          ...readInto(type.item, item, depth + 1, `${indent}  `),
          `${indent}  ${target}.push(${item});`,
          `${indent}}`,
        ];
      }
      case "option": {
        const inner = `some${depth}`;
        return [
          `${indent}let ${target}: ${ts(type)} = null;`,
          `${indent}if (r.flag()) {`,
          ...readInto(type.inner, inner, depth + 1, `${indent}  `),
          `${indent}  ${target} = ${inner};`,
          `${indent}}`,
        ];
      }
    }
    throw new Error(`unknown type ${type.kind}`);
  };

  // Statements that write `value`, an expression of `type`.
  const writeFrom = (type, value, depth, indent) => {
    switch (type.kind) {
      case "number":
      case "count":
      case "flag":
      case "name":
        return [`${indent}w.${type.kind}(${value});`];
      case "ref":
        return [`${indent}write${resolve(type).name}(w, ${value});`];
      case "list": {
        const item = `item${depth}`;
        return [
          `${indent}w.count(${value}.length);`,
          `${indent}for (const ${item} of ${value}) {`,
          ...writeFrom(type.item, item, depth + 1, `${indent}  `),
          `${indent}}`,
        ];
      }
      case "option":
        return [
          `${indent}if (${value} != null) {`,
          `${indent}  w.flag(true);`,
          ...writeFrom(type.inner, value, depth + 1, `${indent}  `),
          `${indent}} else {`,
          `${indent}  w.flag(false);`,
          `${indent}}`,
        ];
    }
    throw new Error(`unknown type ${type.kind}`);
  };

  const used = new Set();
  const out = [];
  for (const type of ordered) {
    out.push("");
    out.push(...jsdoc(type.doc, ""));
    if (type.kind === "enum") {
      used.add("variants");
      out.push(
        `export const ${type.name} = variants(${type.variants.map((v) => JSON.stringify(v)).join(", ")});`,
      );
      out.push(`export type ${type.name} = Infer<typeof ${type.name}>;`);
      continue;
    }
    used.add("struct");
    out.push(`export const ${type.name} = struct({`);
    for (const field of type.fields) {
      out.push(...jsdoc(field.doc, "  "));
      out.push(`  ${field.name}: ${schema(field.type)},`);
    }
    out.push("});");
    out.push(`export type ${type.name} = Infer<typeof ${type.name}>;`);
  }

  for (const item of interfaces) {
    out.push("");
    out.push(...jsdoc(item.doc, ""));
    out.push(`export class ${item.name} {`);
    out.push("  readonly #transport: SyncTransport;");
    out.push("");
    out.push("  constructor(transport: SyncTransport) {");
    out.push("    this.#transport = transport;");
    out.push("  }");
    item.methods.forEach((method, index) => {
      const params = method.params.map((param) => `${param.name}: ${ts(param.type)}`).join(", ");
      out.push("");
      out.push(...jsdoc(method.doc, "  "));
      out.push(`  ${method.name}(${params}): ${ts(method.output)} {`);
      if (method.params.length > 0) out.push("    const w = this.#transport.writer();");
      for (const param of method.params) out.push(...writeFrom(param.type, param.name, 0, "    "));
      const input = method.params.length > 0 ? "w" : "this.#transport.writer()";
      out.push(`    const r = this.#transport.request(${index}, ${input});`);
      out.push(...readInto(method.output, "result", 0, "    "));
      out.push("    return result;");
      out.push("  }");
    });
    out.push("}");
  }

  for (const type of ordered) {
    if (read.has(type.rust)) {
      out.push("");
      out.push(`function read${type.name}(r: Reader): ${type.name} {`);
      if (type.kind === "enum") {
        out.push(`  const value = ${type.name}.names[r.count()];`);
        out.push(
          `  if (value === undefined) throw new Error("unknown ${type.name}, from a module built with another ${type.name}");`,
        );
        out.push("  return value;");
      } else {
        type.fields.forEach((field, index) => {
          out.push(...readInto(field.type, `field${index}`, 0, "  "));
        });
        out.push("  return {");
        type.fields.forEach((field, index) => out.push(`    ${field.name}: field${index},`));
        out.push("  };");
      }
      out.push("}");
    }
    if (written.has(type.rust)) {
      out.push("");
      out.push(`function write${type.name}(w: Writer, value: ${type.name}): void {`);
      if (type.kind === "enum") {
        out.push(`  w.count(${type.name}.names.indexOf(value));`);
      } else {
        for (const field of type.fields) {
          out.push(...writeFrom(field.type, `value.${field.name}`, 0, "  "));
        }
      }
      out.push("}");
    }
  }

  const runtime = [
    "count",
    "flag",
    "list",
    "name",
    "number",
    "option",
    "struct",
    "variants",
  ].filter((name) => used.has(name));
  return [
    header,
    `import { ${[...runtime, "type Infer", "type Reader", "type SyncTransport", "type Writer"].join(", ")} } from "@shift/pack";`,
    ...out,
    "",
  ]
    .filter((line, index) => index > 0 || line !== "")
    .join("\n")
    .replace(/\n\n\n+/g, "\n\n");
}

/** Orders items by their TypeScript name. */
function byName(a, b) {
  return a.name.localeCompare(b.name);
}

/** A fragment without where it came from, for comparing two declarations. */
function strip({ crate: _crate, ...fragment }) {
  return fragment;
}

/** Parenthesises a union or a readonly array so it can take `[]`. */
function wrap(type) {
  return type.includes("|") || type.startsWith("readonly ") ? `(${type})` : type;
}

function jsdoc(doc, indent) {
  if (!doc) return [];
  const lines = doc
    .replaceAll("*/", "*\\/")
    .split("\n")
    .map((line) => line.trim());
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  if (lines.length === 0) return [];
  if (lines.length === 1) return [`${indent}/** ${lines[0]} */`];
  return [
    `${indent}/**`,
    ...lines.map((line) => (line === "" ? `${indent} *` : `${indent} * ${line}`)),
    `${indent} */`,
  ];
}
