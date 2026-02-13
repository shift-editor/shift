import type {
  PersistedDocumentState,
  PersistedModuleEnvelope,
  PersistedRoot,
  PersistenceRegistry,
  PersistedTextRun,
  UserPreferences,
  TextRunModulePayload,
} from "@shift/validation";

export const PERSISTENCE_SCHEMA_VERSION = 1;
export const PERSISTENCE_DOCUMENT_LIMIT = 100;

export type PersistenceScope = "app" | "document";
export type {
  PersistedModuleEnvelope,
  PersistedDocumentState,
  PersistenceRegistry,
  PersistedRoot,
  UserPreferences,
  TextRunModulePayload,
  PersistedTextRun,
};
