import {
  asAxisId,
  asGlyphId,
  asLayerId,
  asNamedInstanceId,
  asNodeId,
  asSourceId,
} from "@shift/types";
import * as z from "zod/v4";

const windowId = z.number().int().positive();
const fontRevision = z.string().min(1).max(256);
const ifFontRevision = fontRevision.optional();
const glyphId = z.string().min(1).transform(asGlyphId);
const sourceId = z.string().min(1).transform(asSourceId);
const instanceId = z.string().min(1).transform(asNamedInstanceId);
const layerId = z.string().min(1).transform(asLayerId);
const axisId = z.string().min(1).transform(asAxisId);
const nodeId = z.string().min(1).max(256).transform(asNodeId);
/** A text position, between items: 0 is before the first. */
const textPosition = z.number().int().min(0);
/** Proof text, as the Text tool reads pasted text. */
const proofText = z.string().max(4096);
const pagePoint = z.strictObject({ x: z.number().finite(), y: z.number().finite() });
const axisCoordinate = z.strictObject({ axisId, value: z.number() });
const location = z.array(axisCoordinate).max(64);
const kerningPosition = z.enum(["first", "second"]);
const name = z.string().min(1).max(256);
const glyphSelector = z.union([z.strictObject({ glyphId }), z.strictObject({ name })]);
const sourceSelector = z.union([z.strictObject({ sourceId }), z.strictObject({ name })]);
/** A layer by stable id, or a glyph's layer at a source (the default source when omitted). */
const layerSelector = {
  byId: { layerId },
  byGlyph: { glyph: glyphSelector, source: sourceSelector.optional() },
};
const layerOverlays = z
  .strictObject({
    points: z.boolean().optional(),
    controlLines: z.boolean().optional(),
    anchors: z.boolean().optional(),
    components: z.boolean().optional(),
    fontMetrics: z.boolean().optional(),
    advanceWidth: z.boolean().optional(),
  })
  .optional();
const layerAppearance = z
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
  .optional();

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
  read: z.strictObject({ windowId }),
  "locations.resolve": z.strictObject({ windowId, ifFontRevision, location }),
  "glyphs.list": z.strictObject({
    windowId,
    ifFontRevision,
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).max(1024).optional(),
    source: sourceSelector.optional(),
  }),
  "glyphs.get": z.union([
    z.strictObject({ windowId, ifFontRevision, glyphId }),
    z.strictObject({ windowId, ifFontRevision, name: z.string().min(1) }),
  ]),
  "sources.get": z.union([
    z.strictObject({ windowId, ifFontRevision, sourceId }),
    z.strictObject({ windowId, ifFontRevision, name }),
  ]),
  "instances.get": z.union([
    z.strictObject({ windowId, ifFontRevision, instanceId }),
    z.strictObject({ windowId, ifFontRevision, name }),
  ]),
  "glyphs.resolve": z.strictObject({
    windowId,
    ifFontRevision,
    glyphIds: z.array(glyphId).min(1).max(100),
    location,
  }),
  "kerning.groups": z.strictObject({
    windowId,
    ifFontRevision,
    position: kerningPosition.optional(),
  }),
  "kerning.pairs": z.strictObject({
    windowId,
    ifFontRevision,
    source: sourceSelector.optional(),
    glyph: glyphSelector.optional(),
    limit: z.number().int().min(1).max(500).optional(),
    cursor: z.string().min(1).max(1024).optional(),
  }),
  "kerning.resolve": z
    .strictObject({
      windowId,
      ifFontRevision,
      pairs: z
        .array(z.strictObject({ first: glyphSelector, second: glyphSelector }))
        .min(1)
        .max(100),
      source: sourceSelector.optional(),
      location: location.optional(),
    })
    .refine(({ source, location }) => !(source && location), {
      message: "kerning.resolve takes source or location, not both",
    }),
  "kerning.at": z.strictObject({
    windowId,
    ifFontRevision,
    first: glyphSelector,
    second: glyphSelector,
    source: sourceSelector.optional(),
  }),
  "text.runs": z.strictObject({ windowId, ifFontRevision, pageId: nodeId.optional() }),
  "text.get": z.strictObject({ windowId, ifFontRevision, runId: nodeId }),
  "text.create": z.strictObject({
    windowId,
    ifFontRevision,
    pageId: nodeId.optional(),
    text: proofText,
    at: pagePoint.optional(),
  }),
  "text.setText": z.strictObject({ windowId, ifFontRevision, runId: nodeId, text: proofText }),
  "text.setCaret": z.strictObject({
    windowId,
    ifFontRevision,
    runId: nodeId,
    position: textPosition,
    selection: z.strictObject({ start: textPosition, end: textPosition }).optional(),
  }),
  "text.delete": z.strictObject({ windowId, ifFontRevision, runId: nodeId }),
  "layers.get": z.union([
    z.strictObject({ windowId, ifFontRevision, ...layerSelector.byId }),
    z.strictObject({ windowId, ifFontRevision, ...layerSelector.byGlyph }),
  ]),
  "layers.resolve": z.union([
    z.strictObject({ windowId, ifFontRevision, ...layerSelector.byId }),
    z.strictObject({ windowId, ifFontRevision, ...layerSelector.byGlyph }),
  ]),
  "layers.render": z.union([
    z.strictObject({
      windowId,
      ifFontRevision,
      ...layerSelector.byId,
      overlays: layerOverlays,
      appearance: layerAppearance,
    }),
    z.strictObject({
      windowId,
      ifFontRevision,
      ...layerSelector.byGlyph,
      overlays: layerOverlays,
      appearance: layerAppearance,
    }),
  ]),
} as const;
