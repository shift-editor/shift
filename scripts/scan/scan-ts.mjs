/**
 * Reports TypeScript structure worth a reviewer's look, read from the compiler's syntax tree:
 * TypeScript that computes what a Rust function of the same name computes (a ported rule),
 * free functions whose first argument is a class of the codebase (maybe a method), classes named
 * as Manager, Store or Cache wrappers, and the `typescript` skill's signs of a type missing a
 * method: `?.` chains across two objects, the same `filter`/`find` in several files, and files
 * leaning on `?? null` / `?? []`, spreads of a condition (`...(x ? { a } : {})`, `...(x && { a })`),
 * and inline functions nested three or more deep. Tests are scanned like other code, except that
 * `rust-twin` skips them (a test recomputing a rule is an oracle, not a port).
 *
 * Two kinds read the diff rather than the tree, and need `--since`:
 * - `test-ledger`: per changed test file, the `it`/`test` cases removed and added (matched by
 *   `describe > name`, so a renamed case shows as one removed and one added), surviving cases
 *   that make fewer `expect` calls, and weakened matchers: an exact matcher (`toBe`, `toEqual`,
 *   `toStrictEqual`, `toMatchObject`, `toHaveLength`, `toBeCloseTo`) on an `expect(subject)` that
 *   now has only a weak one (`toBeTruthy`, `toBeDefined`, `toBeGreaterThan(0)`, `not.toBeNull`,
 *   `not.toBeUndefined`) on the same subject text in the same case.
 * - `refactor-churn`: behaviour tests the diff touched, meaning `*.test.ts(x)` under
 *   `apps/desktop/src/renderer` with no sibling `.ts`/`.tsx` of the same base name (a test beside
 *   its class is a subject test and is expected to change with it).
 *
 * It reports and never fails; anything a rule can decide alone belongs in
 * `scripts/oxlint/shift-plugin.mjs` instead.
 *
 * Usage: node scripts/scan/scan-ts.mjs [--since <rev>] [--kind <kind>]... [<dir>...]
 *
 * It scans the git repository of the current directory. With no directories it scans `packages`
 * and `apps/desktop/src`. `--since` keeps findings in files changed since the branch left `<rev>`
 * (their merge base, working tree included), for reviewing one branch.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = fileURLToPath(new URL("../..", import.meta.url));
const ts = createRequire(path.join(scriptRoot, "package.json"))("typescript");

/** Paths never scanned: dependencies, build output and generated code. */
const SKIPPED = /(node_modules|[/\\]dist[/\\]|generated|\.d\.ts$)/;
const TEST_FILE = /\.(test|spec)\.tsx?$/;
/** Where behaviour tests live; `refactor-churn` looks only here. */
const BEHAVIOUR_ROOT = "apps/desktop/src/renderer/";
const TEST_CALLEES = new Set(["it", "test"]);
const EXACT_MATCHERS = new Set([
  "toBe",
  "toEqual",
  "toStrictEqual",
  "toMatchObject",
  "toHaveLength",
  "toBeCloseTo",
]);
const WRAPPER_CLASS = /(Manager|Store|Cache)$/;
/** A body computing at least this much is reported as a Rust twin. */
const TWIN_WEIGHT = 4;
/** A file with this many `?? null` / `?? []` fallbacks is reported. */
const FALLBACKS = 5;
/** Callbacks nested this deep or deeper are reported, at the outermost. */
const CALLBACK_DEPTH = 3;

export const KINDS = [
  "rust-twin",
  "method-candidate",
  "wrapper-class",
  "cross-object-chain",
  "repeated-filter",
  "fallbacks",
  "conditional-spread",
  "nested-callbacks",
  "test-ledger",
  "refactor-churn",
];
/** Kinds read from the diff against `--since`, not from the tree. */
const DIFF_KINDS = ["test-ledger", "refactor-churn"];

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
    this.#check(node);
    node.forEachChild((child) => this.#visit(child));
  }

  #check(node) {
    const named =
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name && node.body;
    if (named) {
      const name = node.name.getText(this.#source);
      const weight = computeWeight(node.body);
      if (!this.#test && this.#scan.isRustFunction(name) && weight >= TWIN_WEIGHT) {
        this.#report(
          "rust-twin",
          node,
          `${name} computes (weight ${weight}); same name as fn ${snakeCase(name)}, check whether it ports that rule`,
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

    const spread =
      (ts.isSpreadAssignment(node) || ts.isSpreadElement(node)) && conditionOf(node.expression);
    if (spread) {
      this.#report("conditional-spread", node, node.getText(this.#source).slice(0, 80));
    }

    if (isCallback(node) && !hasCallbackAncestor(node)) {
      const depth = callbackDepth(node);
      if (depth >= CALLBACK_DEPTH) {
        const call = node.parent.getText(this.#source).split("\n")[0].slice(0, 70);
        this.#report("nested-callbacks", node, `${depth} functions deep: ${call}`);
      }
    }

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

/** The condition a spread chooses on: `x ? {..} : {}` or `x && {..}`; null otherwise. */
function conditionOf(expression) {
  let inner = expression;
  while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
  const choosing = [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken];
  if (ts.isConditionalExpression(inner)) return inner;
  if (ts.isBinaryExpression(inner) && choosing.includes(inner.operatorToken.kind)) return inner;
  return null;
}

/**
 * A function written inline: a callback, a handler, a returned `() => …`. One given a name (a
 * `const`, an object or class member, such as an arrow-function component) or a test body
 * (`describe`, `it`, `beforeEach`, …) is where nesting starts.
 */
function isCallback(node) {
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return false;
  const parent = node.parent;
  const named =
    ts.isVariableDeclaration(parent) ||
    ts.isPropertyAssignment(parent) ||
    ts.isPropertyDeclaration(parent) ||
    isTestBody(node);
  return !named;
}

const TEST_BODY_CALLEES = new Set([
  "describe",
  "it",
  "test",
  "beforeEach",
  "afterEach",
  "beforeAll",
  "afterAll",
]);

/** True for the function handed to `describe`, `it`, `test` or a hook, including `.each(…)` forms. */
function isTestBody(node) {
  if (!ts.isCallExpression(node.parent) || !node.parent.arguments.includes(node)) return false;
  let callee = node.parent.expression;
  if (ts.isCallExpression(callee)) callee = callee.expression;
  while (ts.isPropertyAccessExpression(callee)) callee = callee.expression;
  return ts.isIdentifier(callee) && TEST_BODY_CALLEES.has(callee.text);
}

function hasCallbackAncestor(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (isCallback(parent)) return true;
  }
  return false;
}

/** How many callbacks deep the deepest path from `callback` goes, counting itself. */
function callbackDepth(callback) {
  let deepest = 0;
  const walk = (node) => {
    if (isCallback(node)) deepest = Math.max(deepest, callbackDepth(node));
    else node.forEachChild(walk);
  };
  callback.body.forEachChild(walk);
  if (isCallback(callback.body)) deepest = Math.max(deepest, callbackDepth(callback.body));
  return deepest + 1;
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

/**
 * What a change to one test file did to its cases: removed and added `it`/`test` cases, cases
 * making fewer `expect` calls, and exact matchers that became weak ones. `before` is null for a
 * new file and `after` null for a deleted one. Heuristic: see the file comment.
 */
export function testLedger(filePath, before, after) {
  const oldCases = before === null ? new Map() : testCases(filePath, before);
  const newCases = after === null ? new Map() : testCases(filePath, after);
  const finding = (line, detail) => ({ path: filePath, line, kind: "test-ledger", detail });

  if (before === null) {
    return newCases.size === 0 ? [] : [finding(1, `new file with ${newCases.size} cases`)];
  }

  const findings = [];
  for (const [name, old] of oldCases) {
    const now = newCases.get(name);
    if (!now) {
      findings.push(finding(1, `removed: ${name} (was line ${old.line})`));
      continue;
    }
    if (now.expects < old.expects) {
      findings.push(finding(now.line, `fewer expects: ${name} (${old.expects} → ${now.expects})`));
    }
    for (const weakened of weakenedMatchers(old.matchers, now.matchers)) {
      findings.push(finding(weakened.line, `weakened: ${name}: ${weakened.detail}`));
    }
  }
  for (const [name, now] of newCases) {
    if (!oldCases.has(name)) findings.push(finding(now.line, `added: ${name}`));
  }
  return findings;
}

/** Each exact matcher on a subject that now has only weak matchers in the same case. */
function weakenedMatchers(oldMatchers, newMatchers) {
  const weakened = [];
  const reported = new Set();
  for (const old of oldMatchers) {
    if (!isExact(old) || reported.has(old.subject)) continue;
    const now = newMatchers.filter((matcher) => matcher.subject === old.subject);
    const weak = now.find(isWeak);
    if (!weak || now.some(isExact)) continue;
    reported.add(old.subject);
    weakened.push({
      line: weak.line,
      detail: `expect(${old.subject}).${old.text} became .${weak.text}`,
    });
  }
  return weakened;
}

function isExact(matcher) {
  return !matcher.negated && EXACT_MATCHERS.has(matcher.name);
}

function isWeak(matcher) {
  if (matcher.negated) return ["toBeNull", "toBeUndefined"].includes(matcher.name);
  if (matcher.name === "toBeGreaterThan") return matcher.args === "0";
  return ["toBeTruthy", "toBeDefined"].includes(matcher.name);
}

/** Cases in a test file keyed by `describe > … > name`, with their line, expects and matchers. */
function testCases(filePath, text) {
  const source = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
  const cases = new Map();
  const visit = (node, scope) => {
    const call = ts.isCallExpression(node) ? testCall(node) : null;
    if (call && call.callee === "describe") {
      node.forEachChild((child) => visit(child, [...scope, call.name]));
      return;
    }
    if (call && !cases.has([...scope, call.name].join(" > "))) {
      const name = [...scope, call.name].join(" > ");
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      cases.set(name, { line, ...assertionsIn(node, source) });
      return;
    }
    node.forEachChild((child) => visit(child, scope));
  };
  visit(source, []);
  return cases;
}

/**
 * `{ callee, name }` for `it("name", …)`, `test.skip("name", …)`, `describe.each(t)("name", …)`
 * and the like; null for any other call or a name that is not a plain string.
 */
function testCall(node) {
  let callee = node.expression;
  if (ts.isCallExpression(callee)) callee = callee.expression;
  while (ts.isPropertyAccessExpression(callee)) callee = callee.expression;
  if (!ts.isIdentifier(callee)) return null;
  const known = TEST_CALLEES.has(callee.text) || callee.text === "describe";
  const [first] = node.arguments;
  if (!known || !first || !ts.isStringLiteralLike(first)) return null;
  return { callee: callee.text, name: first.text };
}

/** How many `expect(…)` calls a case makes, and each matcher with the subject it checks. */
function assertionsIn(node, source) {
  let expects = 0;
  const matchers = [];
  const compact = (text) => text.replace(/\s+/g, "");
  const walk = (child) => {
    if (ts.isCallExpression(child) && isExpectCall(child)) expects++;
    const matcher = ts.isCallExpression(child) ? matcherCall(child) : null;
    if (matcher) {
      const line = source.getLineAndCharacterOfPosition(child.getStart(source)).line + 1;
      const args = compact(child.arguments.map((arg) => arg.getText(source)).join(","));
      const name = child.expression.name.text;
      matchers.push({
        ...matcher,
        subject: compact(matcher.subject.getText(source)),
        name,
        args,
        line,
        text: `${matcher.negated ? "not." : ""}${name}(${args})`,
      });
    }
    child.forEachChild(walk);
  };
  node.forEachChild(walk);
  return { expects, matchers };
}

function isExpectCall(node) {
  return ts.isIdentifier(node.expression) && node.expression.text === "expect";
}

/** `{ subject, negated }` for `expect(subject)[.not].toX(…)`; null for any other call. */
function matcherCall(node) {
  if (!ts.isPropertyAccessExpression(node.expression)) return null;
  if (!node.expression.name.text.startsWith("to")) return null;
  let target = node.expression.expression;
  let negated = false;
  while (ts.isPropertyAccessExpression(target)) {
    if (target.name.text === "not") negated = true;
    target = target.expression;
  }
  if (!ts.isCallExpression(target) || !isExpectCall(target) || !target.arguments[0]) return null;
  return { subject: target.arguments[0], negated };
}

/**
 * Behaviour tests among changed files: `*.test.ts(x)` under `apps/desktop/src/renderer` that do
 * not sit beside a file they are named after. `exists(path)` says whether a repository path exists.
 */
export function refactorChurn(changes, exists) {
  return changes
    .filter((change) => change.path.startsWith(BEHAVIOUR_ROOT) && /\.test\.tsx?$/.test(change.path))
    .filter((change) => !isSubjectTest(change.path, exists))
    .map((change) => ({
      path: change.path,
      line: 1,
      kind: "refactor-churn",
      detail: `behaviour test ${CHANGE_STATUS[change.status] ?? change.status}`,
    }));
}

const CHANGE_STATUS = { A: "added", M: "modified", D: "deleted" };

/** A test named after a sibling source file (`Glyph.test.ts` beside `Glyph.ts`) is a subject test. */
export function isSubjectTest(testPath, exists) {
  const base = testPath.replace(/\.test\.tsx?$/, "");
  return exists(`${base}.ts`) || exists(`${base}.tsx`);
}

function snakeCase(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/** Rust function names with an underscore (single words match too much to mean anything). */
function rustFunctionNames(root) {
  const names = new Set();
  const crates = path.join(root, "crates");
  if (!fs.existsSync(crates)) return names;
  for (const file of walk(crates, /\.rs$/)) {
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
  const diffKind = options.kinds.find((kind) => DIFF_KINDS.includes(kind));
  if (diffKind && !options.since) throw new Error(`--kind ${diffKind} needs --since <rev>`);
  if (options.dirs.length === 0) options.dirs = ["packages", "apps/desktop/src"];
  return options;
}

/** The top of the git repository holding the current directory, so a worktree scans itself. */
function workingRoot() {
  return git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/** Where the current branch left `since`, so a stale `since` does not count its own changes. */
function mergeBase(root, since) {
  return git(root, ["merge-base", since, "HEAD"]).trim();
}

/** Files changed since `since`, as `{ status, path }` with `A`, `M` or `D` (renames split). */
function changesSince(root, since) {
  const output = git(root, ["diff", "--name-status", "--no-renames", since]);
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, filePath] = line.split("\t");
      return { status: status[0], path: filePath };
    });
}

/** A file's text at `rev`, or null when it did not exist there. */
function textAt(root, rev, filePath) {
  try {
    return git(root, ["show", `${rev}:${filePath}`]);
  } catch {
    return null;
  }
}

function diffFindings(root, since, changes, wanted) {
  const findings = [];
  if (wanted("test-ledger")) {
    for (const change of changes.filter((change) => TEST_FILE.test(change.path))) {
      const before = change.status === "A" ? null : textAt(root, since, change.path);
      const absolute = path.join(root, change.path);
      const after = change.status === "D" ? null : fs.readFileSync(absolute, "utf8");
      findings.push(...testLedger(change.path, before, after));
    }
  }
  if (wanted("refactor-churn")) {
    const exists = (filePath) =>
      fs.existsSync(path.join(root, filePath)) || textAt(root, since, filePath) !== null;
    const churn = refactorChurn(changes, exists);
    findings.push(...churn);
    console.error(`refactor-churn: ${churn.length} behaviour test files touched`);
  }
  return findings;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const root = workingRoot();
  const wanted = (kind) => options.kinds.length === 0 || options.kinds.includes(kind);
  const base = options.since ? mergeBase(root, options.since) : null;
  const changes = base ? changesSince(root, base) : null;
  const changed = changes && new Set(changes.map((change) => change.path));

  const scan = new TsScan(rustFunctionNames(root));
  for (const dir of options.dirs) {
    const absolute = path.resolve(root, dir);
    if (!fs.existsSync(absolute)) continue;
    for (const file of walk(absolute, /\.tsx?$/)) {
      scan.add(path.relative(root, file), fs.readFileSync(file, "utf8"));
    }
  }

  const treeFindings = scan.findings().filter((finding) => !changed || changed.has(finding.path));
  const fromDiff = changes ? diffFindings(root, base, changes, wanted) : [];
  const kept = [...treeFindings, ...fromDiff].filter((finding) => wanted(finding.kind));
  for (const finding of kept)
    console.log(`${finding.path}:${finding.line}\t${finding.kind}\t${finding.detail}`);
  console.error(`scan-ts: ${kept.length} findings`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
