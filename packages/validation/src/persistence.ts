import { z } from "zod";

export const GlyphCellSchema = z.object({
  kind: z.literal("glyph"),
  glyphName: z.string().min(1),
  codepoint: z.number().int().nonnegative().nullable(),
});

export const LineBreakSchema = z.object({
  kind: z.literal("linebreak"),
});

export const CellSchema = z.discriminatedUnion("kind", [GlyphCellSchema, LineBreakSchema]);

export const TextBufferSnapshotSchema = z.object({
  cells: z.array(CellSchema),
  cursor: z.number().int().nonnegative(),
  anchor: z.number().int().nonnegative(),
  originX: z.number().finite(),
});

export const PersistedTextRunSchema = z.object({
  buffer: TextBufferSnapshotSchema,
});

export const TextRunModuleSchema = z.object({
  runsByGlyph: z.record(z.string(), PersistedTextRunSchema),
});

export const SnapPreferencesSchema = z.object({
  enabled: z.boolean(),
  angle: z.boolean(),
  metrics: z.boolean(),
  pointToPoint: z.boolean(),
  angleIncrementDeg: z.number().finite(),
  pointRadiusPx: z.number().finite(),
});

export const UserPreferencesSchema = z.object({
  snap: SnapPreferencesSchema,
});

export const PersistedModuleEnvelopeSchema = z.object({
  moduleVersion: z.number().int().nonnegative(),
  payload: z.unknown(),
});

export const PersistenceRegistrySchema = z.object({
  nextDocId: z.number().int().positive(),
  pathToDocId: z.record(z.string(), z.string()),
  docIdToPath: z.record(z.string(), z.string()),
  lruDocIds: z.array(z.string()),
});

export const PersistedDocumentSchema = z.object({
  docId: z.string(),
  updatedAt: z.number().finite(),
  modules: z.record(z.string(), PersistedModuleEnvelopeSchema),
});

export const PersistedRootSchema = z.object({
  version: z.number().int().positive(),
  registry: PersistenceRegistrySchema,
  appModules: z.record(z.string(), PersistedModuleEnvelopeSchema),
  documents: z.record(z.string(), PersistedDocumentSchema),
});

export type PersistedTextRun = z.infer<typeof PersistedTextRunSchema>;
export type TextRunModule = z.infer<typeof TextRunModuleSchema>;
export type SnapPreferencesShape = z.infer<typeof SnapPreferencesSchema>;
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;
export type PersistedModuleEnvelope = z.infer<typeof PersistedModuleEnvelopeSchema>;
export type PersistenceRegistry = z.infer<typeof PersistenceRegistrySchema>;
export type PersistedDocument = z.infer<typeof PersistedDocumentSchema>;
export type PersistedRoot = z.infer<typeof PersistedRootSchema>;
