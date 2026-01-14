#!/usr/bin/env node

/**
 * Script to keep TypeScript types in sync with NAPI-generated types
 *
 * This script:
 * 1. Reads the auto-generated types from crates/shift-node/index.d.ts
 * 2. Transforms them into renderer-compatible types
 * 3. Updates src/renderer/src/types/electron.d.ts
 *
 * Run this after any changes to the Rust NAPI bindings.
 */

const fs = require("fs");
const path = require("path");

const NAPI_TYPES_PATH = path.join(__dirname, "../crates/shift-node/index.d.ts");
const ELECTRON_TYPES_PATH = path.join(
  __dirname,
  "../src/renderer/src/types/electron.d.ts"
);

function extractNAPITypes() {
  const content = fs.readFileSync(NAPI_TYPES_PATH, "utf8");

  // Extract interfaces and enums from NAPI types
  const interfaces = [];
  const enums = [];
  const classMethods = [];

  // Parse interfaces
  const interfaceRegex = /export interface (\w+) \{([^}]+)\}/g;
  let match;
  while ((match = interfaceRegex.exec(content)) !== null) {
    const [, name, body] = match;
    interfaces.push({
      name: name.replace(/^Js/, ""), // Remove Js prefix
      body: body.trim(),
    });
  }

  // Parse enums
  const enumRegex = /export const enum (\w+) \{([^}]+)\}/g;
  while ((match = enumRegex.exec(content)) !== null) {
    const [, name, body] = match;
    enums.push({
      name: name.replace(/JS$/, ""), // Remove JS suffix
      body: body.trim(),
    });
  }

  // Parse class methods
  const classRegex = /export declare class FontEngine \{([^}]+)\}/g;
  if ((match = classRegex.exec(content)) !== null) {
    const [, body] = match;
    const methodLines = body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.includes("constructor"));
    classMethods.push(...methodLines);
  }

  return { interfaces, enums, classMethods };
}

function generateRendererTypes(napiTypes) {
  const { interfaces, enums, classMethods } = napiTypes;

  let output = `import { fontEngine } from "../../../preload/preload";

export type FontEngineInstance = typeof fontEngine;

// Auto-generated types - DO NOT EDIT MANUALLY
// These are synchronized with crates/shift-node/index.d.ts
// Run 'npm run sync-types' to update

`;

  // Generate interfaces
  interfaces.forEach(({ name, body }) => {
    output += `export interface ${name} {\n`;
    output += body
      .split("\n")
      .map((line) => `  ${line.trim()}`)
      .join("\n");
    output += "\n}\n\n";
  });

  // Generate enums
  enums.forEach(({ name, body }) => {
    output += `export enum ${name} {\n`;
    output += body
      .split("\n")
      .map((line) => `  ${line.trim()}`)
      .join("\n");
    output += "\n}\n\n";
  });

  output += `declare global {
  interface Window {
    shiftFont: FontEngineInstance;
  }
}
`;

  return output;
}

function main() {
  try {
    console.log("🔄 Syncing types from NAPI to renderer...");

    const napiTypes = extractNAPITypes();
    const rendererTypes = generateRendererTypes(napiTypes);

    // Create backup
    const backupPath = `${ELECTRON_TYPES_PATH}.backup`;
    if (fs.existsSync(ELECTRON_TYPES_PATH)) {
      fs.copyFileSync(ELECTRON_TYPES_PATH, backupPath);
      console.log(`📄 Created backup at ${backupPath}`);
    }

    // Write new types
    fs.writeFileSync(ELECTRON_TYPES_PATH, rendererTypes);
    console.log(`✅ Updated ${ELECTRON_TYPES_PATH}`);

    console.log("🎉 Type synchronization complete!");
  } catch (error) {
    console.error("❌ Error syncing types:", error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { extractNAPITypes, generateRendererTypes };






