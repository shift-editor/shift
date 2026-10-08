import { asGlyphId, asSourceId } from "@shift/types";
import * as z from "zod/v4";

const windowId = z.number().int().positive();
const glyphId = z.string().min(1).transform(asGlyphId);
const sourceId = z.string().min(1).transform(asSourceId);

/** Validates untrusted scripting inputs before they enter a host capability. */
export const shiftInputSchemas = {
  capture: z.strictObject({
    windowId,
    target: z.enum(["window", "editor"]),
    scale: z.number().min(0.25).max(4).optional().default(1),
  }),
  "font.get": z.strictObject({ windowId }),
  "glyphs.list": z.strictObject({
    windowId,
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).max(1024).optional(),
    sourceId: sourceId.optional(),
  }),
  "glyphs.get": z.union([
    z.strictObject({ windowId, glyphId }),
    z.strictObject({ windowId, name: z.string().min(1) }),
  ]),
  "layers.get": z.strictObject({ windowId, glyphId, sourceId }),
  "layers.render": z.strictObject({
    windowId,
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
