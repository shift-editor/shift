import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import type { AuthoredKerningPair, KerningResolution } from "@shift/runtime";
import { mintSourceId, type GlyphName, type SourceId } from "@shift/types";
import { kerningValueEdit, type Font } from "@shift/editor/model";
import { createWorkspaceStack, type WorkspaceStack } from "@/testing/workspaceStack";
import { ShiftKerningReader } from "./ShiftKerningReader";

const MUTATOR_SANS = resolve(
  process.cwd(),
  "../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace",
);

// T then A kerns through T and A's second-position group at LightCondensed
// (-75), LightWide (-215), and BoldWide (-150); BoldCondensed has a T/A glyph
// exception (-65). The sparse sources author no kerning.
function source(font: Font, name: string): SourceId {
  return font.sources.find((candidate) => candidate.name === name)!.id;
}

/** Removes the pair that kerns T then A at one master, as one undo step. */
async function removeTAAt(stack: WorkspaceStack, sourceName: string): Promise<void> {
  const font = stack.font;
  const sourceId = source(font, sourceName);
  const t = font.recordForName("T" as GlyphName)!.id;
  const a = font.recordForName("A" as GlyphName)!.id;
  const applied = font.kerningCell.peek().resolve(sourceId, t, a)!;
  font.setKerningValues([kerningValueEdit(sourceId, applied)], "Remove kerning");
  await stack.editCoordinator.settled();
}

function masterAt(font: Font, resolution: KerningResolution, sourceName: string) {
  const sourceId = source(font, sourceName);
  return resolution.masters.find((master) => master.sourceId === sourceId)!;
}

describe("ShiftKerningReader serves kerning as the compiled font applies it", () => {
  let stack: WorkspaceStack;
  let reader: ShiftKerningReader;

  beforeEach(async () => {
    stack = createWorkspaceStack();
    await stack.openWorkspace(MUTATOR_SANS);
    reader = new ShiftKerningReader(stack.font);
  });

  afterEach(() => stack.dispose());

  it("reports each master's value and the kind of pair that applies there", () => {
    const font = stack.font;
    const [resolved] = reader.resolve([{ first: { name: "T" }, second: { name: "A" } }], {
      source: { name: "LightCondensed" },
    }).items;

    expect(resolved!.amount).toBe(-75);
    expect(masterAt(font, resolved!, "LightCondensed")).toMatchObject({
      amount: -75,
      origin: "authored",
      rule: "exception",
      pair: { first: { kind: "glyph", name: "T" }, second: { kind: "group" } },
    });
    expect(masterAt(font, resolved!, "BoldCondensed")).toMatchObject({
      amount: -65,
      origin: "authored",
      rule: "glyph",
    });
    expect(masterAt(font, resolved!, "MutatorSansLightCondensed")).toMatchObject({
      origin: "interpolated",
      rule: "none",
      pair: null,
    });
  });

  it("resolves at a master's location the same as at that master", () => {
    const font = stack.font;
    const lightWide = source(font, "LightWide");
    const location = font.designspace.coordinates(font.externalLocationForSource(lightWide)!);

    const [resolved] = reader.resolve([{ first: { name: "T" }, second: { name: "A" } }], {
      location,
    }).items;

    expect(resolved!.amount).toBe(-215);
  });

  it("reports 0 at a master whose pair is removed while it kerns other pairs", async () => {
    await removeTAAt(stack, "LightCondensed");

    const [resolved] = reader.resolve([{ first: { name: "T" }, second: { name: "A" } }], {}).items;

    expect(masterAt(stack.font, resolved!, "LightCondensed")).toMatchObject({
      amount: 0,
      origin: "unkerned",
      pair: null,
    });
  });

  it("interpolates a master whose last pair is removed", async () => {
    await removeTAAt(stack, "BoldWide");

    const [resolved] = reader.resolve([{ first: { name: "T" }, second: { name: "A" } }], {}).items;

    expect(masterAt(stack.font, resolved!, "BoldWide")).toMatchObject({
      amount: -205,
      origin: "interpolated",
    });
  });

  it("resolves at a master chosen by id the same as by name", () => {
    const pair = [{ first: { name: "T" }, second: { name: "A" } }];
    const byId = reader.resolve(pair, {
      source: { sourceId: source(stack.font, "BoldCondensed") },
    });

    expect(byId).toEqual(reader.resolve(pair, { source: { name: "BoldCondensed" } }));
    expect(byId.items[0]!.amount).toBe(-65);
  });

  it("reads one pair at a master, the default source when none is named", () => {
    const font = stack.font;
    const t = { name: "T" };
    const a = { name: "A" };

    expect(reader.at({ first: t, second: a, source: { name: "BoldCondensed" } })).toMatchObject({
      sourceId: source(font, "BoldCondensed"),
      amount: -65,
      origin: "authored",
      rule: "glyph",
    });
    expect(
      reader.at({
        first: { glyphId: font.recordForName("T" as GlyphName)!.id },
        second: a,
        source: { sourceId: source(font, "LightWide") },
      }).amount,
    ).toBe(-215);
    expect(reader.at({ first: t, second: a })).toEqual(
      reader.at({ first: t, second: a, source: { sourceId: font.defaultSource.id } }),
    );
  });

  it("lists a glyph's pairs, directly or through its groups, page by page", () => {
    const source = { name: "LightCondensed" };
    const all = reader.pairs({ source, glyph: { name: "A" } });

    const paged: AuthoredKerningPair[] = [];
    let cursor: string | undefined;
    do {
      const page = reader.pairs({ source, glyph: { name: "A" }, limit: 1, cursor });
      paged.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    expect(all.items.map(({ first, second, amount }) => [first.name, second.kind, amount])).toEqual(
      expect.arrayContaining([
        ["T", "group", -75],
        ["V", "group", -100],
      ]),
    );
    expect(
      all.items.some(({ first, second }) => first.kind === "group" && second.name === "V"),
    ).toBe(true);
    expect(all.nextCursor).toBeNull();
    expect(paged).toEqual(all.items);
  });

  it("lists each group with its member glyphs", () => {
    const groups = reader.groups("second");
    const aGroup = groups.find((group) => group.members.some(({ name }) => name === "A"));

    expect(aGroup).toMatchObject({ position: "second" });
    expect(groups.every((group) => group.position === "second")).toBe(true);
    expect(reader.groups().length).toBeGreaterThan(groups.length);
  });

  it("rejects unknown glyphs, sources, and cursors", () => {
    const t = { name: "T" };

    expect(() => reader.resolve([{ first: { name: "T" }, second: { name: "nope" } }], {})).toThrow(
      "Glyph nope is not in this font",
    );
    expect(() => reader.at({ first: t, second: { name: "nope" } })).toThrow(
      "Glyph nope is not in this font",
    );
    expect(() => reader.at({ first: t, second: t, source: { name: "Nope" } })).toThrow(
      "Source Nope is not in this font",
    );
    expect(() => reader.pairs({ source: { sourceId: mintSourceId() } })).toThrow(
      "is not in this font",
    );
    expect(() => reader.pairs({ cursor: "%%" })).toThrow("Invalid kerning pair cursor");
  });
});
