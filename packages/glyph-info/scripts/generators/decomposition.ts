import { writeFileSync } from "node:fs";

export function generateDecomposition(outputPath: string): {
  decomposedCount: number;
  usedByCount: number;
} {
  const decomposed: Record<string, number[]> = {};
  const usedBy: Record<string, number[]> = {};

  for (let cp = 0x0000; cp <= 0xffff; cp++) {
    // Skip surrogates
    if (cp >= 0xd800 && cp <= 0xdfff) continue;

    const original = String.fromCodePoint(cp);
    const normalized = original.normalize("NFKD");

    if (normalized === original) continue;

    const components = [...normalized].map((ch) => ch.codePointAt(0)!);
    decomposed[cp] = components;

    for (const component of components) {
      if (!usedBy[component]) {
        usedBy[component] = [];
      }
      usedBy[component].push(cp);
    }
  }

  // Sort usedBy arrays for deterministic output
  for (const arr of Object.values(usedBy)) {
    arr.sort((a, b) => a - b);
  }

  writeFileSync(outputPath, JSON.stringify({ decomposed, usedBy }, null, 2));

  return {
    decomposedCount: Object.keys(decomposed).length,
    usedByCount: Object.keys(usedBy).length,
  };
}
