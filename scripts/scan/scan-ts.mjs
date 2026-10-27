/**
 * Reports TypeScript structure worth a reviewer's look, read from the compiler's syntax tree:
 * TypeScript that computes what a Rust function of the same name computes (a ported rule),
 * free functions whose first argument is a class of the codebase (maybe a method), classes named
 * as Manager, Store or Cache wrappers, and the `typescript` skill's signs of a type missing a
 * method: `?.` chains across two objects, the same `filter`/`find` in several files, and files
 * leaning on `?? null` / `?? []`. It reports and never fails; anything a rule can
 * decide alone belongs in `scripts/oxlint/shift-plugin.mjs` instead.
 *
 * Usage: node scripts/scan/scan-ts.mjs [--since <rev>] [--kind <kind>]... [<dir>...]
 *
 * With no directories it scans `packages` and `apps/desktop/src`. `--since` keeps findings in
 * files changed since `<rev>`, for reviewing one branch.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const ts = createRequire(path.join(repositoryRoot, "package.json"))("typescript");

/** Paths never scanned: dependencies, build output and generated code. */
const SKIPPED = /(node_modules|[/\\]dist[/\\]|generated|\.d\.ts$|[/\\]e2e[/\\])/;
const TEST_FILE = /\.(test|spec)\.tsx?$/;
const WRAPPER_CLASS = /(Manager|Store|Cache)$/;
/** A body computing at least this much is reported as a Rust twin. */
const TWIN_WEIGHT = 4;
/** A file with this many `?? null` / `?? []` fallbacks is reported. */
const FALLBACKS = 5;

export const KINDS = [
  "rust-twin",
  "method-candidate",
  "wrapper-class",
  "cross-object-chain",
  "repeated-filter",
  "fallbacks",
];

/** Reports from one set of TypeScript files, knowing the Rust function names to compare with. */
export class TsScan {
  #rustFunctions;
  #classes = new Set();
  #sources = [];

  /** @param rustFunctions - Rust function names in snake case, e.g. `signed_area`. */
  constructor(rustFunctions) {
    this.#rustFunctions = rustFunctions;
  }

  add(fileName, text) {
    const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
    this.#sources.push(source);
    for (const statement of source.statements) {
      if (ts.isClassDeclaration(statement) && statement.name)
        this.#classes.add(statement.name.text);
    }
  }

  findings() {
    const files = this.#sources.map((source) => new FileScan(source, this));
    return [...files.flatMap((file) => file.findings), ...repeatedFilters(files)];
  }

  isClass(name) {
    return this.#classes.has(name);
  }

  isRustFunction(name) {
    return this.#rustFunctions.has(snakeCase(name));
  }
}

class FileScan {
  findings = [];
  /** Each `filter`/`find` predicate in this file, keyed by its text with spacing removed. */
  predicates = new Map();
  #fallbacks = [];
  #source;
  #scan;
  #test;

  constructor(source, scan) {
    this.#source = source;
    this.#scan = scan;
    this.#test = TEST_FILE.test(source.fileName);
    this.#visit(source);
    const [first] = this.#fallbacks;
    if (first && this.#fallbacks.length >= FALLBACKS) {
      this.#report(
        "fallbacks",
        first,
        `${this.#fallbacks.length} \`?? null\` / \`?? []\` in this file`,
      );
    }
  }

  get path() {
    return this.#source.fileName;
  }

  line(node) {
    return this.#source.getLineAndCharacterOfPosition(node.getStart(this.#source)).line + 1;
  }

  #report(kind, node, detail) {
    this.findings.push({
      path: this.path,
      line: this.line(node),
      kind,
      detail: detail.replace(/\s+/g, " "),
    });
  }

  #visit(node) {
    if (!this.#test) this.#check(node);
    node.forEachChild((child) => this.#visit(child));
  }

  #check(node) {
    const named =
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name && node.body;
    if (named) {
      const name = node.name.getText(this.#source);
      const weight = computeWeight(node.body);
      if (this.#scan.isRustFunction(name) && weight >= TWIN_WEIGHT) {
        this.#report(
          "rust-twin",
          node,
          `${name} computes (weight ${weight}) like fn ${snakeCase(name)}`,
        );
      }
    }

    if (named && ts.isFunctionDeclaration(node) && ts.isSourceFile(node.parent)) {
      const first = node.parameters[0]?.type?.getText(this.#source).replace(/^readonly /, "");
      if (first && this.#scan.isClass(first)) {
        this.#report("method-candidate", node, `${node.name.text} takes ${first} first`);
      }
    }

    if (ts.isClassDeclaration(node) && node.name && WRAPPER_CLASS.test(node.name.text)) {
      this.#report(
        "wrapper-class",
        node,
        `${node.name.text}: does it wrap the bridge or another store?`,
      );
    }

    // `a.glyphForId(id)?.layerForSource(source)`: the call's result is optional and read again.
    const crossesObjects =
      ts.isPropertyAccessExpression(node) &&
      node.questionDotToken &&
      ts.isCallExpression(node.expression) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      ts.isCallExpression(node.parent);
    if (crossesObjects) {
      this.#report("cross-object-chain", node, node.parent.getText(this.#source).slice(0, 80));
    }

    const fallsBack =
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
      (node.right.kind === ts.SyntaxKind.NullKeyword ||
        (ts.isArrayLiteralExpression(node.right) && node.right.elements.length === 0));
    if (fallsBack) this.#fallbacks.push(node);

    const filters =
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ["filter", "find"].includes(node.expression.name.text) &&
      node.arguments[0] &&
      ts.isArrowFunction(node.arguments[0]);
    if (filters) {
      const predicate = node.arguments[0].getText(this.#source).replace(/\s+/g, "");
      if (predicate.length >= 20) this.predicates.set(predicate, node);
    }
  }
}

/** How much a body computes: loops, branches, arithmetic and array passes, not calls handing work on. */
export function computeWeight(body) {
  const arithmetic = new Set([
    ts.SyntaxKind.PlusToken,
    ts.SyntaxKind.MinusToken,
    ts.SyntaxKind.AsteriskToken,
    ts.SyntaxKind.SlashToken,
    ts.SyntaxKind.LessThanToken,
    ts.SyntaxKind.GreaterThanToken,
  ]);
  const passes = new Set(["map", "filter", "reduce", "find", "some", "every", "sort"]);
  let weight = 0;
  const walk = (node) => {
    const branches =
      ts.isForStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isIfStatement(node) ||
      ts.isConditionalExpression(node);
    const computes = ts.isBinaryExpression(node) && arithmetic.has(node.operatorToken.kind);
    const pass =
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      passes.has(node.expression.name.text);
    if (branches || computes || pass) weight++;
    node.forEachChild(walk);
  };
  walk(body);
  return weight;
}

/** The same `filter`/`find` predicate written in more than one file, reported at its first. */
function repeatedFilters(files) {
  const byPredicate = Map.groupBy(
    files.flatMap((file) =>
      [...file.predicates].map(([predicate, node]) => ({ predicate, node, file })),
    ),
    (use) => use.predicate,
  );
  return [...byPredicate.values()]
    .filter((uses) => uses.length >= 2)
    .map(([first, ...rest]) => ({
      path: first.file.path,
      line: first.file.line(first.node),
      kind: "repeated-filter",
      detail: `${first.predicate.slice(0, 60)} also in ${rest.map((use) => use.file.path).join(", ")}`,
    }));
}

function snakeCase(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/** Rust function names with an underscore (single words match too much to mean anything). */
function rustFunctionNames() {
  const names = new Set();
  for (const file of walk(path.join(repositoryRoot, "crates"), /\.rs$/)) {
    for (const match of fs
      .readFileSync(file, "utf8")
      .matchAll(/\bfn ([a-z][a-z0-9]*_[a-z0-9_]+)/g)) {
      names.add(match[1]);
    }
  }
  return names;
}

function* walk(dir, pattern) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (SKIPPED.test(file) || entry.name === "target") continue;
    if (entry.isDirectory()) yield* walk(file, pattern);
    else if (pattern.test(entry.name)) yield file;
  }
}

function parseArguments(args) {
  const options = { dirs: [], since: null, kinds: [] };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--since") options.since = args[++index];
    else if (arg === "--kind") options.kinds.push(args[++index]);
    else options.dirs.push(arg);
  }
  const unknown = options.kinds.find((kind) => !KINDS.includes(kind));
  if (unknown) throw new Error(`unknown kind ${unknown}; one of ${KINDS.join(", ")}`);
  if (options.dirs.length === 0) options.dirs = ["packages", "apps/desktop/src"];
  return options;
}

function changedFiles(since) {
  if (!since) return null;
  const output = execFileSync("git", ["diff", "--name-only", since], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  return new Set(output.split("\n").filter(Boolean));
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const changed = changedFiles(options.since);
  const scan = new TsScan(rustFunctionNames());
  for (const dir of options.dirs) {
    for (const file of walk(path.resolve(repositoryRoot, dir), /\.tsx?$/)) {
      scan.add(path.relative(repositoryRoot, file), fs.readFileSync(file, "utf8"));
    }
  }

  const kept = scan
    .findings()
    .filter((finding) => options.kinds.length === 0 || options.kinds.includes(finding.kind))
    .filter((finding) => !changed || changed.has(finding.path));
  for (const finding of kept)
    console.log(`${finding.path}:${finding.line}\t${finding.kind}\t${finding.detail}`);
  console.error(`scan-ts: ${kept.length} findings`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
