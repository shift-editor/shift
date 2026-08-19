#!/usr/bin/env node
// Usage: node scripts/check-docs-fences.mjs
//
// Type-checks every ```ts / ```typescript fence in DOCS.md files against the
// module's own tsconfig, so documented snippets can't reference renamed or
// removed symbols. A fence that is deliberately a non-compiling fragment opts
// out with an info string: ```ts illustrative
//
// Bash fences are validated by context-drift-check.py; the rare rust fence is
// currently unchecked (cargo doctest would need built deps).
//
// Exit code 0 = all fences compile, 1 = diagnostics found.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const docs = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "*docs/DOCS.md"],
  { cwd: repoRoot, encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean);

/** Extract [{lang, info, code, line}] for fenced blocks in a markdown file. */
function extractFences(markdown) {
  const fences = [];
  const lines = markdown.split("\n");
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(```+)\s*(.*)$/);
    if (!match) {
      if (open) open.code.push(lines[i]);
      continue;
    }
    if (open) {
      fences.push({ ...open, code: open.code.join("\n") });
      open = null;
    } else {
      const [lang, ...rest] = match[2].trim().split(/\s+/);
      open = { lang: lang ?? "", info: rest.join(" "), code: [], line: i + 1 };
    }
  }
  return fences;
}

let failures = 0;
let checked = 0;

for (const doc of docs) {
  const absDoc = path.join(repoRoot, doc);
  const moduleDir = path.dirname(path.dirname(absDoc));
  const configPath = ts.findConfigFile(moduleDir, ts.sys.fileExists, "tsconfig.json");
  const fences = extractFences(readFileSync(absDoc, "utf8")).filter(
    (fence) => ["ts", "typescript"].includes(fence.lang) && !/\billustrative\b/.test(fence.info),
  );
  if (fences.length === 0) continue;
  if (!configPath) {
    console.error(`${doc}: has ts fences but no tsconfig.json above it`);
    failures++;
    continue;
  }

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
  const options = {
    ...parsed.options,
    noEmit: true,
    skipLibCheck: true,
    // The virtual fence file is never part of the project's file list, and
    // examples may bind results without using them.
    composite: false,
    incremental: false,
    tsBuildInfoFile: undefined,
    noUnusedLocals: false,
    noUnusedParameters: false,
  };

  for (const fence of fences) {
    checked++;
    const virtualPath = path.join(path.dirname(absDoc), `__docs_fence_${fence.line}__.ts`);
    const host = ts.createCompilerHost(options);
    const defaultReadFile = host.readFile.bind(host);
    const defaultFileExists = host.fileExists.bind(host);
    host.readFile = (file) => (file === virtualPath ? fence.code : defaultReadFile(file));
    host.fileExists = (file) => file === virtualPath || defaultFileExists(file);

    const program = ts.createProgram([virtualPath], options, host);
    const diagnostics = [
      ...program.getSyntacticDiagnostics(program.getSourceFile(virtualPath)),
      ...program.getSemanticDiagnostics(program.getSourceFile(virtualPath)),
    ];
    if (diagnostics.length > 0) {
      failures++;
      console.error(`\n${doc}: fence at line ${fence.line} does not compile:`);
      for (const diagnostic of diagnostics.slice(0, 5)) {
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
        const position =
          diagnostic.file && diagnostic.start !== undefined
            ? `:${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1}`
            : "";
        console.error(`  TS${diagnostic.code}${position}: ${message}`);
      }
    }
  }
}

console.log(`\n${checked} ts fence(s) checked, ${failures} failing`);
process.exit(failures > 0 ? 1 : 0);
