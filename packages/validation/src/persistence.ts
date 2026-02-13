import { z } from "zod";

export const PersistedTextRunSchema = z.object({
  codepoints: z.array(z.number().int().nonnegative()),
  cursorPosition: z.number().int().nonnegative(),
  originX: z.number().finite(),
  editingIndex: z.number().int().nonnegative().nullable(),
  editingUnicode: z.number().int().nonnegative().nullable(),
});

export const TextRunModulePayloadSchema = z.object({
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

export const PersistedDocumentStateSchema = z.object({
  docId: z.string(),
  updatedAt: z.number().finite(),
  modules: z.record(z.string(), PersistedModuleEnvelopeSchema),
});

export const PersistedRootSchema = z.object({
  version: z.number().int().positive(),
  registry: PersistenceRegistrySchema,
  appModules: z.record(z.string(), PersistedModuleEnvelopeSchema),
  documents: z.record(z.string(), PersistedDocumentStateSchema),
});

export type PersistedTextRun = z.infer<typeof PersistedTextRunSchema>;
export type TextRunModulePayload = z.infer<typeof TextRunModulePayloadSchema>;
export type SnapPreferencesShape = z.infer<typeof SnapPreferencesSchema>;
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;
export type PersistedModuleEnvelope = z.infer<typeof PersistedModuleEnvelopeSchema>;
export type PersistenceRegistry = z.infer<typeof PersistenceRegistrySchema>;
export type PersistedDocumentState = z.infer<typeof PersistedDocumentStateSchema>;
export type PersistedRoot = z.infer<typeof PersistedRootSchema>;
