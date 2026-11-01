#!/usr/bin/env node
// Finds Rust NAPI methods in bridge.rs with no TypeScript caller.
// Run: node scripts/check-napi-dead-methods.mjs

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RUST_FILE = "crates/shift-bridge/src/bridge.rs";
const CALLER_ROOTS = ["apps/desktop/src", "packages/bridge/src", "crates/shift-bridge/__test__"];
const CALLER_EXTENSIONS = /\.(c|m)?(t|j)sx?$/;

// The name is the identifier after `pub fn`; generics, lifetimes and where
// clauses that follow it never reach the name.
const METHOD = /^\s+pub fn ([A-Za-z_][A-Za-z0-9_]*)/gm;

/** Returns the names of the indented `pub fn` methods in `source`, except `new`. */
export function rustMethodNames(source) {
  return [...source.matchAll(METHOD)].map((match) => match[1]).filter((name) => name !== "new");
}

/** Converts a snake_case Rust name to the camelCase name napi exports. */
export function camelCase(name) {
  const [head, ...rest] = name.split("_");
  return head + rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
}

/** Returns the methods in `rustSource` that no `callerSource` calls as `.name`. */
export function deadMethods(rustSource, callerSource) {
  return rustMethodNames(rustSource).filter((name) => {
    const call = new RegExp(`\\.${camelCase(name)}\\b`);
    return !call.test(callerSource);
  });
}

function readTree(root) {
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return "";
  }

  return entries
    .map((entry) => {
      const path = join(root, entry);
      if (statSync(path).isDirectory()) return readTree(path);
      if (!CALLER_EXTENSIONS.test(entry)) return "";
      return readFileSync(path, "utf8");
    })
    .join("\n");
}

function main() {
  const rustSource = readFileSync(RUST_FILE, "utf8");
  const callerSource = CALLER_ROOTS.map(readTree).join("\n");
  const dead = deadMethods(rustSource, callerSource);

  if (dead.length === 0) {
    console.log("All Rust NAPI methods have TypeScript callers.");
    return;
  }

  console.log("Dead Rust NAPI methods (no TypeScript caller):");
  for (const name of dead) console.log(`  - ${name} → ${camelCase(name)}`);
  console.log(`\nEither delete from ${RUST_FILE} or add TypeScript callers.`);
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
