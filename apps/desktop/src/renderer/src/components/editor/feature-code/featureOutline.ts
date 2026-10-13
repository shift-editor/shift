export type OutlineKind = "languagesystem" | "class" | "lookup" | "feature";

/** One navigable entry in the feature code. */
export interface OutlineEntry {
  readonly kind: OutlineKind;
  readonly name: string;
  /** Character offset of the entry's first character. */
  readonly from: number;
  /** Character offset just past the entry: its closing brace, bracket, or semicolon. */
  readonly to: number;
  /** For a class, how many members it lists. */
  readonly count?: number;
  /** Lookups declared inside a feature block. */
  readonly children: readonly OutlineEntry[];
}

interface OpenBlock {
  readonly kind: "lookup" | "feature";
  readonly name: string;
  readonly from: number;
  readonly depth: number;
  readonly children: OutlineEntry[];
}

/**
 * Lists the language systems, classes, lookups, and features in feature code,
 * with the lookups each feature declares nested under it. A line scan for the
 * spike; the real outline comes from the compiler's syntax tree.
 */
export function featureOutline(source: string): readonly OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  const stack: OpenBlock[] = [];
  let depth = 0;
  let offset = 0;

  const add = (entry: OutlineEntry) => {
    const parent = stack.at(-1);
    if (parent) parent.children.push(entry);
    else entries.push(entry);
  };

  for (const line of source.split("\n")) {
    const code = line.replace(/#.*/, "");
    const system = /^\s*languagesystem\s+(\S+)\s+(\S+?)\s*;/.exec(code);
    const glyphClass = /^\s*(@[\w.-]+)\s*=\s*\[/.exec(code);
    const block = /^\s*(lookup|feature)\s+([\w.-]+)\s*(?:useExtension\s*)?\{/.exec(code);

    if (system) {
      const name = `${system[1]} ${system[2]}`;
      add({ kind: "languagesystem", name, from: offset, to: offset + line.length, children: [] });
    }
    if (glyphClass && stack.length === 0) {
      const start = offset + glyphClass.index + glyphClass[0].length;
      const close = source.indexOf("]", start);
      const end = close === -1 ? source.length : close + 1;
      const members = source
        .slice(start, end - 1)
        .replace(/#.*/g, "")
        .split(/\s+/)
        .filter(Boolean);
      add({
        kind: "class",
        name: glyphClass[1]!,
        from: offset,
        to: end,
        count: members.length,
        children: [],
      });
    }
    if (block) {
      const kind = block[1] === "feature" ? "feature" : "lookup";
      stack.push({ kind, name: block[2]!, from: offset, depth, children: [] });
    }

    for (let index = 0; index < code.length; index++) {
      const char = code[index];
      if (char === "{") depth += 1;
      if (char !== "}") continue;
      depth = Math.max(0, depth - 1);
      const open = stack.at(-1);
      if (open && open.depth === depth) {
        stack.pop();
        add({ ...open, to: offset + index + 1 });
      }
    }
    offset += line.length + 1;
  }

  return entries;
}

/** The innermost blocks containing `offset`, outermost first, for breadcrumbs. */
export function enclosingEntries(
  entries: readonly OutlineEntry[],
  offset: number,
): readonly OutlineEntry[] {
  const path: OutlineEntry[] = [];
  let level = entries;
  for (;;) {
    const inside = level.find((entry) => entry.from <= offset && offset <= entry.to);
    if (!inside) return path;
    path.push(inside);
    level = inside.children;
  }
}
