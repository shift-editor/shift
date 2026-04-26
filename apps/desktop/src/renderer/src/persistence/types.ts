import type {
  PersistedDocument,
  PersistedModuleEnvelope,
  PersistedRoot,
  PersistenceRegistry,
  PersistedTextRun,
  UserPreferences,
  TextRunModule,
} from "@shift/validation";

export const PERSISTENCE_SCHEMA_VERSION = 1;
export const PERSISTENCE_DOCUMENT_LIMIT = 100;

export type PersistenceScope = "app" | "document";
export type {
  PersistedModuleEnvelope,
  PersistedDocument,
  PersistenceRegistry,
  PersistedRoot,
  UserPreferences,
  TextRunModule,
  PersistedTextRun,
};
