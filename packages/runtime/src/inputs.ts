import { asAxisId, asGlyphId, asSourceId } from "@shift/types";
import * as z from "zod/v4";

const windowId = z.number().int().positive();
const fontRevision = z.string().min(1).max(256);
const ifFontRevision = fontRevision.optional();
const glyphId = z.string().min(1).transform(asGlyphId);
const sourceId = z.string().min(1).transform(asSourceId);
const axisId = z.string().min(1).transform(asAxisId);
const axisCoordinate = z.strictObject({ axisId, value: z.number() });
const location = z.array(axisCoordinate).max(64);

/** Validates untrusted scripting inputs before they enter a host capability. */
export const shiftInputSchemas = {
  capture: z.strictObject({
    windowId,
    ifFontRevision,
    target: z.enum(["window", "editor"]),
    scale: z.number().min(0.25).max(4).optional().default(1),
  }),
  "editor.inspect": z.strictObject({ windowId, ifFontRevision }),
  "font.get": z.strictObject({ windowId, ifFontRevision }),
  "locations.resolve": z.strictObject({ windowId, ifFontRevision, location }),
  "glyphs.list": z.strictObject({
    windowId,
    ifFontRevision,
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).max(1024).optional(),
    sourceId: sourceId.optional(),
  }),
  "glyphs.get": z.union([
    z.strictObject({ windowId, ifFontRevision, glyphId }),
    z.strictObject({ windowId, ifFontRevision, name: z.string().min(1) }),
  ]),
  "glyphs.resolve": z.strictObject({
    windowId,
    ifFontRevision,
    glyphIds: z.array(glyphId).min(1).max(100),
    location,
  }),
  "layers.get": z.strictObject({ windowId, ifFontRevision, glyphId, sourceId }),
  "layers.render": z.strictObject({
    windowId,
    ifFontRevision,
    glyphId,
    sourceId,
    overlays: z
      .strictObject({
        points: z.boolean().optional(),
        controlLines: z.boolean().optional(),
        anchors: z.boolean().optional(),
        components: z.boolean().optional(),
        fontMetrics: z.boolean().optional(),
        advanceWidth: z.boolean().optional(),
      })
      .optional(),
    appearance: z
      .strictObject({
        outlineFill: z.string().min(1).optional(),
        onCurveStroke: z.string().min(1).optional(),
        offCurveStroke: z.string().min(1).optional(),
        handleFill: z.string().min(1).optional(),
        controlStroke: z.string().min(1).optional(),
        anchorStroke: z.string().min(1).optional(),
        metricStroke: z.string().min(1).optional(),
        advanceStroke: z.string().min(1).optional(),
        componentStroke: z.string().min(1).optional(),
      })
      .optional(),
  }),
} as const;
