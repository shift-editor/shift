import { readFileSync, writeFileSync } from "node:fs";
import type { LetterSkeleton } from "../../src/types.js";

const NO_JOINING_GROUP = "No_Joining_Group";

interface ShapingEntry {
  codepoint: number;
  /** The letter's shape as Unicode describes it: `DOTLESS BEH WITH 2 DOTS ABOVE` for teh. */
  schematicName: string;
  joiningGroup: string;
}

/**
 * Writes each joining-script letter's skeleton from Unicode's ArabicShaping.txt.
 *
 * @remarks
 * Letters drawn on one skeleton share a joining group (beh, teh and theh are
 * all `BEH`), and the group's skeleton is the member Unicode names after it
 * with no dots: `DOTLESS BEH`, or plain `HAH` where the base letter has none.
 * A letter outside every group (hamza) is its own skeleton when its name adds
 * nothing (`HAMZA`, not `... WITH ...`).
 *
 * @returns the number of letters written.
 */
export function generateSkeletons(arabicShapingPath: string, outputPath: string): number {
  const text = readFileSync(arabicShapingPath, "utf-8");
  const entries = parseArabicShaping(text);
  const skeletonByGroup = groupSkeletons(entries);

  const skeletons: LetterSkeleton[] = entries.flatMap((entry) => {
    const skeleton =
      entry.joiningGroup === NO_JOINING_GROUP
        ? plainShape(entry)
        : skeletonByGroup.get(entry.joiningGroup);
    return skeleton === undefined ? [] : [{ codepoint: entry.codepoint, skeleton }];
  });

  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        source: {
          name: "Unicode Character Database",
          file: text.match(/^# (ArabicShaping-[\d.]+\.txt)/)?.[1] ?? "ArabicShaping.txt",
          url: "https://www.unicode.org/Public/UCD/latest/ucd/ArabicShaping.txt",
          license: "Unicode-3.0",
        },
        skeletons,
      },
      null,
      2,
    ),
  );

  return skeletons.length;
}

function parseArabicShaping(text: string): ShapingEntry[] {
  return text.split("\n").flatMap((line) => {
    const content = line.split("#")[0]?.trim();
    if (!content) return [];

    const [hex, schematicName, , joiningGroup] = content.split(";").map((field) => field.trim());
    if (!hex || !schematicName || !joiningGroup) return [];

    return [{ codepoint: Number.parseInt(hex, 16), schematicName, joiningGroup }];
  });
}

/** Each joining group's dotless member: `DOTLESS <group>`, else the member named `<group>`. */
function groupSkeletons(entries: readonly ShapingEntry[]): Map<string, number> {
  const dotless = new Map<string, number>();
  const plain = new Map<string, number>();
  for (const entry of entries) {
    if (entry.schematicName === `DOTLESS ${entry.joiningGroup}`) {
      dotless.set(entry.joiningGroup, entry.codepoint);
    }
    if (entry.schematicName === entry.joiningGroup) plain.set(entry.joiningGroup, entry.codepoint);
  }

  const skeletons = new Map(plain);
  for (const [group, codepoint] of dotless) skeletons.set(group, codepoint);
  return skeletons;
}

function plainShape(entry: ShapingEntry): number | undefined {
  return entry.schematicName.includes(" WITH ") ? undefined : entry.codepoint;
}
