import type {
  AxisId,
  GlyphEntry,
  GlyphId,
  ParagraphRequest,
  ShapedRun,
  ShaperFont,
  ShapeUnit,
} from "@shift/types";
import { registerShaper, releaseShaper } from "@shift/wasm/shaping";
import {
  setShaperGlyphs,
  shapeParagraphs,
  type ParagraphInput,
  type ShapedRunOutput,
} from "./generated/shapingLayouts";

const released = new FinalizationRegistry<number>(releaseShaper);

/**
 * A shaper font registered in `@shift/wasm/shaping`, which shapes with
 * shift-shape, the shaper the workspace uses.
 *
 * @remarks
 * Loaded through `loadShaping` so this module, and the shaping module it
 * imports, load only when text first needs shaping. The module's copy is
 * released when this object is collected.
 */
export class RegisteredShaper {
  /** The shaper font's revision; a new one means new tables. */
  readonly revision: number;
  readonly #handle: number;
  readonly #glyphIds: readonly (GlyphId | null)[];
  readonly #shaperGlyphs: ReadonlyMap<GlyphId, number>;
  readonly #axisIds: readonly AxisId[];

  /**
   * Registers a shaper font and maps characters through `glyphs`.
   *
   * @throws When the module cannot read the shaper font.
   */
  constructor(font: ShaperFont, glyphs: readonly GlyphEntry[]) {
    this.revision = font.revision;
    this.#handle = registerShaper(font.bytes);
    released.register(this, this.#handle);
    this.#glyphIds = font.glyphIds;
    this.#shaperGlyphs = new Map(
      font.glyphIds.flatMap((glyphId, index) => (glyphId ? [[glyphId, index] as const] : [])),
    );
    this.#axisIds = font.axes.map((axis) => axis.axisId);

    const codepoints: number[] = [];
    const shaperGlyphs: number[] = [];
    for (const glyph of glyphs) {
      const shaperGlyph = this.#shaperGlyphs.get(glyph.id);
      if (shaperGlyph === undefined) continue;
      for (const codepoint of glyph.unicodes) {
        codepoints.push(codepoint);
        shaperGlyphs.push(shaperGlyph);
      }
    }
    setShaperGlyphs({
      shaper: this.#handle,
      axes: font.axes,
      codepoints,
      glyphs: shaperGlyphs,
    });
  }

  /**
   * Shapes paragraphs, as `Font.shapeParagraphs` does in the workspace.
   *
   * @returns Each paragraph's runs in logical order, in request order; null
   * for a paragraph that cannot be shaped.
   */
  shapeParagraphs(paragraphs: readonly ParagraphRequest[]): (ShapedRun[] | null)[] {
    const shaped = shapeParagraphs({
      shaper: this.#handle,
      paragraphs: paragraphs.map((paragraph) => this.#input(paragraph)),
    });
    return shaped.map((runs) => (runs ? runs.map((run) => this.#run(run)) : null));
  }

  #input(paragraph: ParagraphRequest): ParagraphInput {
    const units = paragraph.units.map((unit) => this.#unit(unit));
    const location = this.#axisIds.map((axisId) => paragraph.location.values[axisId] ?? NaN);
    const language = paragraph.language ? codeUnits(paragraph.language) : [];
    const features = (paragraph.features ?? []).map(({ tag, value: setting }) => ({
      tag: tagNumber(tag),
      setting,
    }));
    return { units, location, language, features };
  }

  /** A code point, or `-(glyph + 1)` for a glyph inserted by name. */
  #unit(unit: ShapeUnit): number {
    if (unit.glyphId === undefined) return unit.codepoint ?? 0;

    return -((this.#shaperGlyphs.get(unit.glyphId) ?? 0) + 1);
  }

  #run(run: ShapedRunOutput): ShapedRun {
    const script = run.script === 0 ? undefined : tagString(run.script);
    return {
      start: run.start,
      end: run.end,
      ...(script ? { script } : {}),
      direction: run.rightToLeft ? "rtl" : "ltr",
      glyphs: run.glyphs.map((glyph) => {
        const glyphId = glyph.glyph == null ? null : (this.#glyphIds[glyph.glyph] ?? null);
        return {
          ...(glyphId ? { glyphId } : {}),
          cluster: glyph.cluster,
          xAdvance: glyph.xAdvance,
          yAdvance: glyph.yAdvance,
          xOffset: glyph.xOffset,
          yOffset: glyph.yOffset,
        };
      }),
    };
  }
}

function codeUnits(text: string): number[] {
  const units: number[] = [];
  for (let index = 0; index < text.length; index++) units.push(text.charCodeAt(index));
  return units;
}

/** Returns a four-character OpenType tag as its bytes, big-endian. */
function tagNumber(tag: string): number {
  let value = 0;
  for (let index = 0; index < 4; index++) {
    value = value * 256 + (index < tag.length ? tag.charCodeAt(index) : 0x20);
  }
  return value;
}

/** Returns a tag's four bytes as text, without trailing spaces. */
function tagString(value: number): string {
  let tag = "";
  for (let shift = 24; shift >= 0; shift -= 8) tag += String.fromCharCode((value >>> shift) & 0xff);
  return tag.trimEnd();
}
