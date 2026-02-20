/**
 * Find all references to a symbol using the TypeScript compiler API via ts-morph.
 *
 * Usage:
 *   npx tsx scripts/find-refs.ts <file-path> <symbol-name>
 *
 * Examples:
 *   npx tsx scripts/find-refs.ts apps/desktop/src/renderer/src/lib/editor/Editor.ts undo
 *   npx tsx scripts/find-refs.ts packages/geo/src/Vec2.ts Vec2
 *
 * Output:
 *   Each line shows: file:line  kind  (definition | reference)
 *   Exit code 0 = references found, exit code 1 = no references (or error)
 */

import { Project, type Node } from "ts-morph";
import path from "node:path";

const [, , filePath, symbolName] = process.argv;

if (!filePath || !symbolName) {
  console.error("Usage: npx tsx scripts/find-refs.ts <file-path> <symbol-name>");
  process.exit(1);
}

const absolutePath = path.resolve(filePath);

const project = new Project({
  tsConfigFilePath: path.resolve("apps/desktop/tsconfig.json"),
  skipAddingFilesFromTsConfig: false,
});

// Also add package sources that the desktop tsconfig may not include directly
const packageGlobs = ["packages/*/src/**/*.ts", "packages/*/src/**/*.tsx"];
for (const glob of packageGlobs) {
  project.addSourceFilesAtPaths(glob);
}

const sourceFile = project.getSourceFile(absolutePath);
if (!sourceFile) {
  console.error(`File not found in project: ${filePath}`);
  process.exit(1);
}

function findSymbolNodes(file: typeof sourceFile): Node[] {
  if (!file) return [];
  const nodes: Node[] = [];

  // Find class members, functions, variables, interfaces, type aliases, enums
  for (const cls of file.getClasses()) {
    if (cls.getName() === symbolName) nodes.push(cls.getNameNode()!);
    for (const member of cls.getMembers()) {
      const name = "getName" in member ? (member as any).getName() : undefined;
      if (name === symbolName) {
        const nameNode = "getNameNode" in member ? (member as any).getNameNode() : undefined;
        if (nameNode) nodes.push(nameNode);
      }
    }
  }

  for (const fn of file.getFunctions()) {
    if (fn.getName() === symbolName) nodes.push(fn.getNameNode()!);
  }

  for (const v of file.getVariableDeclarations()) {
    if (v.getName() === symbolName) nodes.push(v.getNameNode());
  }

  for (const iface of file.getInterfaces()) {
    if (iface.getName() === symbolName) nodes.push(iface.getNameNode());
    for (const member of iface.getMembers()) {
      const name = "getName" in member ? (member as any).getName() : undefined;
      if (name === symbolName) {
        const nameNode = "getNameNode" in member ? (member as any).getNameNode() : undefined;
        if (nameNode) nodes.push(nameNode);
      }
    }
  }

  for (const ta of file.getTypeAliases()) {
    if (ta.getName() === symbolName) nodes.push(ta.getNameNode());
  }

  for (const en of file.getEnums()) {
    if (en.getName() === symbolName) nodes.push(en.getNameNode());
  }

  return nodes;
}

const symbolNodes = findSymbolNodes(sourceFile);

if (symbolNodes.length === 0) {
  console.error(`Symbol "${symbolName}" not found in ${filePath}`);
  process.exit(1);
}

const cwd = process.cwd();
let totalDefinitions = 0;
let totalReferences = 0;

for (const node of symbolNodes) {
  const refs = project.getLanguageService().findReferences(node);

  for (const refEntry of refs) {
    for (const ref of refEntry.getReferences()) {
      const refFile = ref.getSourceFile().getFilePath();
      const line = ref.getNode().getStartLineNumber();
      const kind = ref.isDefinition() ? "definition" : "reference";
      const relativePath = path.relative(cwd, refFile);

      if (ref.isDefinition()) {
        totalDefinitions++;
      } else {
        totalReferences++;
      }

      console.log(`${relativePath}:${line}\t${kind}`);
    }
  }
}

console.log(`\n--- Summary ---`);
console.log(`Definitions: ${totalDefinitions}`);
console.log(`References:  ${totalReferences}`);

if (totalReferences === 0) {
  console.log(`\nResult: "${symbolName}" appears to be DEAD CODE (no non-definition references)`);
  process.exit(1);
} else {
  console.log(`\nResult: "${symbolName}" is USED (${totalReferences} reference(s) found)`);
  process.exit(0);
}
