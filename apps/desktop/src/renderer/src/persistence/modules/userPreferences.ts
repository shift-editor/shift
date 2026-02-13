import type { PersistenceModule } from "../module";
import type { UserPreferences } from "../types";
import { UserPreferencesSchema } from "@shift/validation";

export const userPreferencesModule: PersistenceModule<UserPreferences> = {
  id: "user-preferences",
  scope: "app",
  version: 1,
  capture: ({ editor }) => ({
    snap: editor.getSnapPreferences(),
  }),
  hydrate: ({ editor }, payload) => {
    editor.setSnapPreferences(payload.snap);
  },
  validate: (payload: unknown): payload is UserPreferences =>
    UserPreferencesSchema.safeParse(payload).success,
};
